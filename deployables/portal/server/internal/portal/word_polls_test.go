package portal

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestWordPollsNormalizeVoteModerateAggregateAndExport(t *testing.T) {
	app, pool := timelineApp(t)
	ctx := context.Background()
	draft := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Wörter","description":"","kind":"words"}`), http.StatusCreated)
	if draft.Kind != "words" || draft.Repeatable || draft.MaxChoices != 3 || len(draft.Options) != 0 || len(draft.MyWords) != 0 {
		t.Fatalf("word poll defaults: %+v", draft)
	}
	for _, body := range []string{
		`{"name":"Bad options","description":"","kind":"words","options":[{"label":"not allowed"}]}`,
		`{"name":"Bad cap","description":"","kind":"words","max_choices":0}`,
		`{"name":"Bad cap","description":"","kind":"words","max_choices":501}`,
	} {
		if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body); res.Code != http.StatusBadRequest {
			t.Fatalf("invalid word poll definition accepted: %d %s", res.Code, res.Body)
		}
	}
	path := "/api/v1/categories/" + draft.ID
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", `{"words":["draft"]}`); res.Code != http.StatusNotFound {
		t.Fatalf("student voted in draft: %d", res.Code)
	}
	opened := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, draft.Version)), http.StatusOK)
	if len(opened.Options) != 0 {
		t.Fatal("opening a word poll created generic options")
	}

	vote := func(actor, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		res := authenticatedRequest(t, app, pool, actor, http.MethodPut, path+"/ballot", body)
		if res.Code != want {
			t.Fatalf("vote status=%d want=%d: %s", res.Code, want, res.Body)
		}
		return res
	}
	first := vote(MiaID, `{"words":[" ÄPFEL ","Birne","=2+2"]}`, http.StatusOK)
	var firstResult struct {
		Words     []string `json:"words"`
		OptionIDs []string `json:"option_ids"`
		OptionID  string   `json:"option_id"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstResult); err != nil {
		t.Fatal(err)
	}
	if len(firstResult.Words) != 3 || len(firstResult.OptionIDs) != 3 || firstResult.OptionID != firstResult.OptionIDs[0] || !slices.Contains(firstResult.Words, "äpfel") {
		t.Fatalf("normalized vote response: %+v", firstResult)
	}
	var optionCount, auditCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM poll_options WHERE poll_id=$1", draft.ID).Scan(&optionCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", draft.ID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if optionCount != 3 || auditCount != 3 {
		t.Fatalf("initial vote options=%d audit=%d", optionCount, auditCount)
	}
	// NFC and lowercase normalization make a reordered equivalent vote a no-op.
	vote(MiaID, `{"words":["birne","äpfel","=2+2"]}`, http.StatusOK)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", draft.ID).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("equivalent vote changed history: count=%d err=%v", auditCount, err)
	}
	for _, words := range []string{
		`["Äpfel","äpfel"]`,
		`["valid","two words"]`,
		`["valid","a\nb"]`,
		fmt.Sprintf(`["%s"]`, strings.Repeat("😀", 65)),
		`["one","two","three","four"]`,
	} {
		vote(MiaID, `{"words":`+words+`}`, http.StatusBadRequest)
	}
	vote(MiaID, `{"option_ids":["40000000-0000-4000-8000-000000000101"]}`, http.StatusBadRequest)
	vote(MiaID, `{"words":["valid"],"option_ids":null}`, http.StatusBadRequest)
	vote(GuestID, `{"words":["guest"]}`, http.StatusForbidden)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM poll_options WHERE poll_id=$1", draft.ID).Scan(&optionCount); err != nil || optionCount != 3 {
		t.Fatalf("invalid requests left options behind: count=%d err=%v", optionCount, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", draft.ID).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("invalid requests changed history: count=%d err=%v", auditCount, err)
	}

	vote(LeonID, `{"words":["äpfel","kirsche"]}`, http.StatusOK)
	for _, actor := range []string{MiaID, LeonID, ManagerID, AdminID} {
		category := categoriesFor(t, app, actor)[draft.ID]
		if len(category.Options) != 0 {
			t.Fatalf("%s sees word options in generic category payload", actor)
		}
		want := 0
		switch actor {
		case MiaID:
			want = 3
		case LeonID:
			want = 2
		}
		if len(category.MyWords) != want || len(category.MyOptionIDs) != want {
			t.Fatalf("%s own-only words/ids: %+v", actor, category)
		}
	}
	var entries []WordEntry
	res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/words", "")
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &entries) != nil || len(entries) != 4 {
		t.Fatalf("editor word entries: %d %s", res.Code, res.Body)
	}
	byWord := map[string]WordEntry{}
	for _, entry := range entries {
		byWord[entry.Word] = entry
	}
	if byWord["äpfel"].Count != 2 || byWord["birne"].Count != 1 || byWord["kirsche"].Count != 1 {
		t.Fatalf("original word counts: %+v", byWord)
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, path+"/words", ""); res.Code != http.StatusForbidden {
		t.Fatalf("student read moderation list: %d", res.Code)
	}
	for _, endpoint := range []string{path + "/results", path + "/words/export", path + "/audit"} {
		if res := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, endpoint, ""); res.Code != http.StatusForbidden {
			t.Fatalf("student read editor endpoint %s: %d", endpoint, res.Code)
		}
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, path+"/words/"+byWord["birne"].OptionID, `{"version":1,"label":"Äpfel","excluded":false}`); res.Code != http.StatusForbidden {
		t.Fatalf("unassigned manager moderated words: %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/words/export", ""); res.Code != http.StatusOK {
		t.Fatalf("unassigned manager could not export words: %d", res.Code)
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET category_ids=array_append(category_ids,$2::uuid) WHERE id=$1", ManagerID, draft.ID); err != nil {
		t.Fatal(err)
	}

	moderate := func(actor, optionID string, version int, label string, excluded bool, want int) WordEntry {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"version": version, "label": label, "excluded": excluded})
		res := authenticatedRequest(t, app, pool, actor, http.MethodPatch, path+"/words/"+optionID, string(body))
		if res.Code != want {
			t.Fatalf("moderation status=%d want=%d: %s", res.Code, want, res.Body)
		}
		if want != http.StatusOK {
			return WordEntry{}
		}
		var item WordEntry
		if err := json.Unmarshal(res.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		return item
	}
	birne := byWord["birne"]
	merged := moderate(ManagerID, birne.OptionID, birne.Version, " ÄPFEL ", false, http.StatusOK)
	if merged.Word != "birne" || merged.Label != "äpfel" || merged.Count != 1 || merged.Version != 2 {
		t.Fatalf("moderated entry changed the original: %+v", merged)
	}
	moderate(ManagerID, birne.OptionID, birne.Version, "birne", false, http.StatusConflict)
	results := func() []PollResult {
		t.Helper()
		var got []PollResult
		res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/results", "")
		if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &got) != nil {
			t.Fatalf("word results: %d %s", res.Code, res.Body)
		}
		return got
	}
	resultRows := results()
	resultCounts := map[string]int{}
	for _, item := range resultRows {
		resultCounts[item.Label] = item.Count
	}
	if resultCounts["äpfel"] != 2 || resultCounts["kirsche"] != 1 || resultCounts["=2+2"] != 1 {
		t.Fatalf("merged result counts must count each voter once: %+v", resultCounts)
	}
	kirsche := byWord["kirsche"]
	excluded := moderate(ManagerID, kirsche.OptionID, kirsche.Version, "Kirsche", true, http.StatusOK)
	if !excluded.Excluded || excluded.Label != "kirsche" {
		t.Fatalf("word exclusion: %+v", excluded)
	}
	resultRows = results()
	if slices.ContainsFunc(resultRows, func(item PollResult) bool { return item.Label == "kirsche" }) {
		t.Fatal("excluded word appeared in results")
	}
	export := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/words/export", "")
	if export.Code != http.StatusOK || export.Header().Get("Content-Type") != "text/csv; charset=utf-8" || export.Header().Get("Content-Disposition") != `attachment; filename="words.csv"` {
		t.Fatalf("word export headers: %d %v", export.Code, export.Header())
	}
	csvRows, err := csv.NewReader(strings.NewReader(export.Body.String())).ReadAll()
	if err != nil || len(csvRows) != 3 || csvRows[0][0] != "word" || csvRows[1][0] != "'=2+2" || csvRows[1][1] != "1" || csvRows[2][0] != "äpfel" || csvRows[2][1] != "2" {
		t.Fatalf("formula-safe aggregate CSV: rows=%v err=%v", csvRows, err)
	}
	moderate(ManagerID, kirsche.OptionID, excluded.Version, "kirsche", false, http.StatusOK)
	reset := moderate(ManagerID, birne.OptionID, merged.Version, "BIRNE", false, http.StatusOK)
	if reset.Label != "birne" || reset.Word != "birne" || reset.Version != 3 {
		t.Fatalf("moderation reset did not restore original: %+v", reset)
	}

	var history []BallotAudit
	res = authenticatedRequest(t, app, pool, AdminID, http.MethodGet, path+"/audit", "")
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history) != 5 {
		t.Fatalf("admin named word history: %d %s", res.Code, res.Body)
	}
	if !slices.ContainsFunc(history, func(item BallotAudit) bool { return item.OptionLabel == "birne" }) {
		t.Fatal("named audit did not retain original word labels")
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/audit", ""); res.Code != http.StatusForbidden {
		t.Fatalf("manager read named word history: %d", res.Code)
	}

	closed := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, opened.Version)), http.StatusOK)
	vote(MiaID, `{"words":["closed"]}`, http.StatusConflict)
	hidden := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"draft"}`, closed.Version)), http.StatusOK)
	if _, visible := categoriesFor(t, app, MiaID)[draft.ID]; visible {
		t.Fatal("student saw hidden word poll")
	}
	reopened := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, hidden.Version)), http.StatusOK)
	if !slices.Contains(categoriesFor(t, app, MiaID)[draft.ID].MyWords, "äpfel") {
		t.Fatal("hiding and reopening discarded the student's current words")
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, path, fmt.Sprintf(`{"version":%d}`, reopened.Version)); res.Code != http.StatusNoContent {
		t.Fatalf("delete words poll: %d %s", res.Code, res.Body)
	}
	for _, table := range []string{"ballots", "ballot_audit", "poll_options"} {
		var count int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE poll_id=$1", draft.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("delete left %s rows=%d err=%v", table, count, err)
		}
	}
	var hasGrant bool
	if err := pool.QueryRow(ctx, "SELECT $1::uuid=ANY(category_ids) FROM users WHERE id=$2", draft.ID, ManagerID).Scan(&hasGrant); err != nil || hasGrant {
		t.Fatalf("delete left manager grant=%v err=%v", hasGrant, err)
	}
}

func TestWordBallotReplacementPreservesCompleteSnapshotsAndTurnout(t *testing.T) {
	app, pool := timelineApp(t)
	draft := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Replacement","description":"","kind":"words","max_choices":2}`), http.StatusCreated)
	path := "/api/v1/categories/" + draft.ID
	decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, draft.Version)), http.StatusOK)
	vote := func(body string) {
		t.Helper()
		if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", body); res.Code != http.StatusOK {
			t.Fatalf("vote: %d %s", res.Code, res.Body)
		}
	}
	vote(`{"words":["Apfel","Birne"]}`)
	first := categoriesFor(t, app, MiaID)[draft.ID].MyOptionIDs
	vote(`{"words":["Kirsche","Pflaume"]}`)
	second := categoriesFor(t, app, MiaID)[draft.ID].MyOptionIDs
	if len(first) != 2 || len(second) != 2 || slices.Equal(first, second) {
		t.Fatalf("replacement did not change the full selection: first=%v second=%v", first, second)
	}
	category := categoriesFor(t, app, ManagerID)[draft.ID]
	if len(category.Options) != 0 || category.BallotCount == nil || *category.BallotCount != 1 || category.Participation == nil || category.Participation.Voted != 1 {
		t.Fatalf("replacement changed turnout or exposed options: %+v", category)
	}
	var results []PollResult
	res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/results", "")
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &results) != nil || len(results) != 2 {
		t.Fatalf("replacement results: %d %s", res.Code, res.Body)
	}
	for _, result := range results {
		if result.Label == "apfel" || result.Label == "birne" || result.Count != 1 {
			t.Fatalf("old aggregate remained or new aggregate is wrong: %+v", results)
		}
	}
	var ballotCount int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM ballots WHERE poll_id=$1 AND user_id=$2", draft.ID, MiaID).Scan(&ballotCount); err != nil || ballotCount != 2 {
		t.Fatalf("current ballot has %d words, err=%v", ballotCount, err)
	}
	vote(`{"words":["pflaume","Kirsche"]}`)
	var history []BallotAudit
	res = authenticatedRequest(t, app, pool, AdminID, http.MethodGet, path+"/audit", "")
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history) != 4 {
		t.Fatalf("replacement history: %d %s", res.Code, res.Body)
	}
	groups := map[string][]string{}
	for _, item := range history {
		if item.BallotID == nil {
			t.Fatal("replacement history has no ballot group")
		}
		groups[*item.BallotID] = append(groups[*item.BallotID], item.OptionID)
	}
	if len(groups) != 2 {
		t.Fatalf("replacement should produce two complete snapshots: %+v", groups)
	}
	foundFirst, foundSecond := false, false
	for _, group := range groups {
		slices.Sort(group)
		foundFirst = foundFirst || slices.Equal(group, first)
		foundSecond = foundSecond || slices.Equal(group, second)
	}
	if !foundFirst || !foundSecond {
		t.Fatalf("history did not preserve both complete selections: %+v", groups)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", draft.ID).Scan(&ballotCount); err != nil || ballotCount != 4 {
		t.Fatalf("equivalent reorder created history: count=%d err=%v", ballotCount, err)
	}
}
