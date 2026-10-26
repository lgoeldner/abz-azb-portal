package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"testing"
)

func TestProposalMultipleSelectionsPreserveCapAndReplaceAtomically(t *testing.T) {
	app, pool := timelineApp(t)
	options := `"options":[{"label":"A"},{"label":"B"},{"label":"C"}]`
	draft := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Motto","kind":"proposal","max_choices":2,`+options+`}`), 201)
	path := "/api/v1/categories/" + draft.ID
	draft = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, fmt.Sprintf(`{"name":"Motto neu","kind":"proposal","version":%d,%s}`, draft.Version, options)), 200)
	if draft.AllPeople || draft.MaxChoices != 2 || len(draft.Options) != 3 {
		t.Fatal("proposal edit lost explicit choices or omitted choice limit")
	}
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, draft.Version)), 200)
	ids := []string{poll.Options[0].ID, poll.Options[1].ID, poll.Options[2].ID}
	vote := func(actor string, selected []string, want int) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"option_ids": selected})
		res := authenticatedRequest(t, app, pool, actor, http.MethodPut, path+"/ballot", string(body))
		if res.Code != want {
			t.Fatalf("proposal vote status=%d want %d", res.Code, want)
		}
	}
	vote(MiaID, ids[:2], 200)
	vote(MiaID, []string{ids[1], ids[0]}, 200)
	vote(MiaID, ids[1:], 200)
	vote(MiaID, ids, 400)
	vote(MiaID, []string{ids[0], ids[0]}, 400)
	vote(MiaID, []string{ids[0], "40000000-0000-4000-8000-000000000101"}, 400)
	vote(LeonID, ids[:1], 200)
	mine := categoriesFor(t, app, MiaID)[poll.ID]
	if !slices.Equal(mine.MyOptionIDs, sortedCopy(ids[1:])) || mine.BallotCount != nil || mine.Version != poll.Version {
		t.Fatal("failed proposal vote changed selections, exposed turnout, or changed definition")
	}
	if got := categoriesFor(t, app, LeonID)[poll.ID].MyOptionIDs; !slices.Equal(got, ids[:1]) {
		t.Fatal("voter received someone else's selections")
	}
	count := categoriesFor(t, app, AdminID)[poll.ID].BallotCount
	if count == nil || *count != 2 {
		t.Fatal("proposal turnout must count voters rather than choices")
	}
	var results []PollResult
	res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/results", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &results) != nil || len(results) != 3 {
		t.Fatal("proposal results unavailable")
	}
	for _, result := range results {
		if result.Count != 1 {
			t.Fatal("proposal results did not count each selected option")
		}
	}
	for _, actor := range []string{MiaID, ManagerID} {
		if res := authenticatedRequest(t, app, pool, actor, http.MethodGet, path+"/audit", ""); res.Code != 403 {
			t.Fatal("named proposal history exposed to non-admin")
		}
	}
	var history []BallotAudit
	res = authenticatedRequest(t, app, pool, AdminID, http.MethodGet, path+"/audit", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history) != 5 {
		t.Fatal("proposal history changed on rejected or reordered selections")
	}
	groups := map[string][]string{}
	for _, entry := range history {
		if entry.BallotID == nil {
			t.Fatal("proposal selection snapshot missing grouping")
		}
		groups[*entry.BallotID] = append(groups[*entry.BallotID], entry.OptionID)
	}
	for _, want := range [][]string{ids[:2], ids[1:], ids[:1]} {
		found := false
		for _, group := range groups {
			found = found || slices.Equal(sortedCopy(group), sortedCopy(want))
		}
		if !found {
			t.Fatal("proposal history lost an entire selection snapshot")
		}
	}
}

func TestMigration006PreservesDefinitionsVotesAndHistory(t *testing.T) {
	pool, issuer := migrateTo(t, "005_people_multiselect.sql")
	ctx := context.Background()
	if err := SeedWithIssuer(ctx, pool, "development", issuer); err != nil {
		t.Fatal(err)
	}
	app := appForPool(t, pool, issuer)
	// Seed the pre-007 schema directly. The current API reads the new category
	// and ballot columns, so it cannot be used until the migration is applied.
	legacyBallotID := "50000000-0000-4000-8000-000000000001"
	if _, err := pool.Exec(ctx, `INSERT INTO ballots(poll_id,user_id,option_id) VALUES($1,$2,$3)`, pollOpen, MiaID, "40000000-0000-4000-8000-000000000101"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id) VALUES($1,$2,$3,$4,$5)`, ID(), pollOpen, MiaID, "40000000-0000-4000-8000-000000000101", legacyBallotID); err != nil {
		t.Fatal(err)
	}
	snapshot := func(query string) string {
		t.Helper()
		var result string
		if err := pool.QueryRow(ctx, query).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	queries := map[string]string{
		"categories":   `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM (SELECT id,name,description,kind,status,allow_self_vote,version,created_at,opened_at,all_people,max_choices FROM categories) r`,
		"poll_options": `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM poll_options r`,
		"ballots":      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM (SELECT poll_id,user_id,option_id,created_at FROM ballots) r`,
		"ballot_audit": `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM ballot_audit r`,
	}
	before := map[string]string{}
	for table, query := range queries {
		before[table] = snapshot(query)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for table, rows := range before {
		if snapshot(queries[table]) != rows {
			t.Fatalf("migration changed existing %s", table)
		}
	}
	if c := categoriesFor(t, app, MiaID)[pollOpen]; c.MaxChoices != 1 || c.AllPeople || !slices.Equal(c.MyOptionIDs, []string{"40000000-0000-4000-8000-000000000101"}) {
		t.Fatal("migration changed legacy single-choice semantics")
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+pollOpen+"/ballot", `{"option_ids":["40000000-0000-4000-8000-000000000101","40000000-0000-4000-8000-000000000102"]}`); res.Code != 400 {
		t.Fatal("migration silently widened an existing proposal choice limit")
	}
}
