package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestPeoplePollRosterSnapshotsAndExplicitSubset(t *testing.T) {
	app, pool := timelineApp(t)
	ctx := context.Background()
	create := func(body string) Category {
		t.Helper()
		return decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body), 201)
	}
	all := create(`{"name":"Alle","description":"","kind":"person","max_choices":2}`)
	if !all.AllPeople || all.MaxChoices != 2 || len(all.Options) < 2 {
		t.Fatalf("new person default: %+v", all)
	}
	all = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+all.ID, fmt.Sprintf(`{"name":"Alle neu","description":"","kind":"person","version":%d}`, all.Version)), 200)
	if !all.AllPeople || all.MaxChoices != 2 {
		t.Fatal("omitted edit settings changed mode or choice limit")
	}
	candidate := ID()
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,subject,name,admitted,cohort_member) VALUES($1,$2,'New candidate',true,true)", candidate, ID()); err != nil {
		t.Fatal(err)
	}
	find := func(c Category, id string) bool {
		return slices.ContainsFunc(c.Options, func(o PollOption) bool { return o.UserID != nil && *o.UserID == id })
	}
	if find(all, candidate) {
		t.Fatal("draft changed before opening")
	}
	opened := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+all.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, all.Version)), 200)
	if !find(opened, candidate) {
		t.Fatal("opening did not refresh admitted cohort")
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET admitted=false,name='Changed name' WHERE id=$1", candidate); err != nil {
		t.Fatal(err)
	}
	frozen := categoriesFor(t, app, MiaID)[all.ID]
	if !find(frozen, candidate) || !slices.EqualFunc(opened.Options, frozen.Options, func(a, b PollOption) bool { return a.ID == b.ID && a.Label == b.Label }) {
		t.Fatal("open candidate snapshot changed")
	}
	body := fmt.Sprintf(`{"name":"Subset","description":"","kind":"person","all_people":false,"max_choices":2,"options":[{"label":"Mia","user_id":%q},{"label":"Leon","user_id":%q}]}`, MiaID, LeonID)
	subset := create(body)
	edited := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+subset.ID, strings.Replace(strings.Replace(body, `"all_people":false,`, "", 1), `"name":`, fmt.Sprintf(`"version":%d,"name":`, subset.Version), 1)), 200)
	if edited.AllPeople || edited.MaxChoices != 2 || len(edited.Options) != 2 {
		t.Fatalf("legacy edit lost explicit subset: %+v", edited)
	}
	for _, bad := range []string{
		`{"name":"Bad","description":"","kind":"person","max_choices":0}`,
		`{"name":"Bad","description":"","kind":"person","max_choices":501}`,
		`{"name":"Bad","description":"","kind":"proposal","all_people":true,"options":[{"label":"A"},{"label":"B"}]}`,
		`{"name":"Bad","description":"","kind":"proposal","max_choices":0,"options":[{"label":"A"},{"label":"B"}]}`,
		`{"name":"Bad","description":"","kind":"proposal","max_choices":501,"options":[{"label":"A"},{"label":"B"}]}`,
		`{"name":"Bad","description":"","kind":"idea","all_people":true}`,
		`{"name":"Bad","description":"","kind":"idea","max_choices":2}`,
	} {
		if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", bad); res.Code != 400 {
			t.Fatalf("invalid definition accepted: %d", res.Code)
		}
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/categories", `{"name":"No","description":"","kind":"person"}`); res.Code != 403 {
		t.Fatalf("student create: %d", res.Code)
	}
}

func TestPeopleMultipleSelectionsReplaceAtomicallyAndAuditSnapshots(t *testing.T) {
	app, pool := timelineApp(t)
	ctx := context.Background()
	draft := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"People","description":"","kind":"person","max_choices":2}`), 201)
	path := "/api/v1/categories/" + draft.ID
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", fmt.Sprintf(`{"option_id":%q}`, draft.Options[0].ID)); res.Code != 404 {
		t.Fatalf("draft vote: %d", res.Code)
	}
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, draft.Version)), 200)
	var self string
	other := []string{}
	for _, o := range poll.Options {
		if *o.UserID == MiaID {
			self = o.ID
		} else {
			other = append(other, o.ID)
		}
	}
	if len(other) < 3 {
		t.Fatal("fixture needs three other candidates")
	}
	vote := func(actor string, ids []string, want int) {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"option_ids": ids})
		res := authenticatedRequest(t, app, pool, actor, http.MethodPut, path+"/ballot", string(b))
		if res.Code != want {
			t.Fatalf("vote: %d want %d: %s", res.Code, want, res.Body)
		}
	}
	auditCount := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", poll.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	first := sortedCopy(other[:2])
	second := sortedCopy(other[1:3])
	vote(MiaID, first, 200)
	vote(MiaID, []string{first[1], first[0]}, 200)
	if auditCount() != 2 {
		t.Fatal("repeated selection created audit rows")
	}
	vote(MiaID, second, 200)
	for _, ids := range [][]string{{}, {other[0], other[0]}, other[:3], {other[0], self}, {other[0], "40000000-0000-4000-8000-000000000101"}} {
		vote(MiaID, ids, 400)
	}
	vote(GuestID, first, 403)
	both := fmt.Sprintf(`{"option_id":%q,"option_ids":[%q]}`, first[0], first[1])
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", both); res.Code != 400 {
		t.Fatalf("ambiguous ballot: %d", res.Code)
	}
	for _, body := range []string{`{"option_id":null,"option_ids":[]}`, `{"option_id":null}`, `{"option_ids":null}`} {
		if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", body); res.Code != 400 {
			t.Fatalf("null ballot accepted: %d", res.Code)
		}
	}
	mine := categoriesFor(t, app, MiaID)[poll.ID]
	if !slices.Equal(mine.MyOptionIDs, second) || mine.MyOptionID == nil || *mine.MyOptionID != second[0] || auditCount() != 4 {
		t.Fatalf("failed request changed vote: %+v", mine)
	}
	count := categoriesFor(t, app, AdminID)[poll.ID].BallotCount
	if count == nil || *count != 1 {
		t.Fatalf("count must be distinct voters: %v", count)
	}
	var results []PollResult
	res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/results", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &results) != nil {
		t.Fatal("results unavailable")
	}
	total := 0
	for _, r := range results {
		total += r.Count
	}
	if total != 2 {
		t.Fatalf("results count selections: %d", total)
	}
	var history []BallotAudit
	res = authenticatedRequest(t, app, pool, AdminID, http.MethodGet, path+"/audit", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &history) != nil || len(history) != 4 {
		t.Fatalf("audit: %d", res.Code)
	}
	groups := map[string][]string{}
	for _, h := range history {
		if h.BallotID == nil {
			t.Fatal("snapshot missing ballot_id")
		}
		groups[*h.BallotID] = append(groups[*h.BallotID], h.OptionID)
	}
	foundFirst, foundSecond := false, false
	for _, ids := range groups {
		slices.Sort(ids)
		foundFirst = foundFirst || slices.Equal(ids, first)
		foundSecond = foundSecond || slices.Equal(ids, second)
	}
	if len(groups) != 2 || !foundFirst || !foundSecond {
		t.Fatal("audit lost original or replacement snapshot")
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, path+"/audit", ""); res.Code != 403 {
		t.Fatalf("manager named ballot access: %d", res.Code)
	}
	// Concurrent replacements must leave one complete set, never a mix of requests.
	responses := make(chan int, 2)
	for _, selection := range [][]string{first, second} {
		go func(ids []string) {
			body, _ := json.Marshal(map[string]any{"option_ids": ids})
			responses <- authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", string(body)).Code
		}(selection)
	}
	for range 2 {
		if code := <-responses; code != 200 {
			t.Fatalf("concurrent replacement: %d", code)
		}
	}
	current := categoriesFor(t, app, MiaID)[poll.ID].MyOptionIDs
	if !slices.Equal(current, first) && !slices.Equal(current, second) {
		t.Fatal("concurrent requests mixed selections")
	}
	// A legacy request replaces the complete multi-selection, retaining one choice.
	res = authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", fmt.Sprintf(`{"option_id":%q}`, first[0]))
	if res.Code != 200 || len(categoriesFor(t, app, MiaID)[poll.ID].MyOptionIDs) != 1 {
		t.Fatal("legacy ballot did not replace selection")
	}
	decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, poll.Version)), 200)
	vote(MiaID, second, 409)
}
