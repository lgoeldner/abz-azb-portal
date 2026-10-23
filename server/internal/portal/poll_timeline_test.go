package portal

import (
	"abizeitbetrug/server/internal/authmock"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func timelineApp(t *testing.T) (*App, *pgxpool.Pool) {
	t.Helper()
	pool := integrationPool(t)
	ctx := context.Background()
	provider := mockProvider(t, "", "http://localhost:8080", []authmock.User{{Subject: MiaID, Name: "Mia"}})
	if err := SeedWithIssuer(ctx, pool, "development", provider.URL); err != nil {
		t.Fatal(err)
	}
	c := Config{Env: "development", DatabaseURL: "postgres://unused", PublicURL: "http://localhost:8080", UploadDir: t.TempDir(), StaticDir: t.TempDir(), AuthMode: "mock", Issuer: provider.URL, ClientID: "portal-dev", ClientSecret: "dev-only", SessionSecret: strings.Repeat("s", 32)}
	app, err := New(ctx, c, pool)
	if err != nil {
		t.Fatal(err)
	}
	return app, pool
}

func decodePoll(t *testing.T, res *httptest.ResponseRecorder, want int) Poll {
	t.Helper()
	if res.Code != want {
		t.Fatalf("status=%d want %d: %s", res.Code, want, res.Body)
	}
	var p Poll
	if err := json.Unmarshal(res.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// listedPoll returns the poll as served by GET /polls plus its raw JSON object.
func listedPoll(t *testing.T, app *App, pool *pgxpool.Pool, userID, id string) (Poll, map[string]json.RawMessage) {
	t.Helper()
	res := authenticatedRequest(t, app, pool, userID, http.MethodGet, "/api/v1/polls", "")
	if res.Code != http.StatusOK {
		t.Fatalf("list status=%d: %s", res.Code, res.Body)
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(res.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	for _, r := range raw {
		if strings.Trim(string(r["id"]), `"`) == id {
			var p Poll
			b, _ := json.Marshal(r)
			if err := json.Unmarshal(b, &p); err != nil {
				t.Fatal(err)
			}
			return p, r
		}
	}
	t.Fatalf("poll %s not listed for %s", id, userID)
	return Poll{}, nil
}

func TestPollOpenedAtIsSetOnceAndSurvivesClosing(t *testing.T) {
	app, pool := timelineApp(t)
	body := fmt.Sprintf(`{"category_id":%q,"title":"Timeline","description":"","kind":"proposal","allow_self_vote":false,"options":[{"label":"A"},{"label":"B"}],"version":0}`, categoryID(1))
	draft := decodePoll(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/polls", body), http.StatusCreated)
	if draft.OpenedAt != nil || draft.CreatedAt.IsZero() || time.Since(draft.CreatedAt) > time.Minute {
		t.Fatalf("draft timeline: created=%v opened=%v", draft.CreatedAt, draft.OpenedAt)
	}
	if _, raw := listedPoll(t, app, pool, ManagerID, draft.ID); string(raw["opened_at"]) != "null" {
		t.Fatalf("draft opened_at must be an explicit null, got %s", raw["opened_at"])
	}
	// Editing a draft does not open it.
	edited := decodePoll(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/polls/"+draft.ID, strings.Replace(body, `"version":0`, fmt.Sprintf(`"version":%d`, draft.Version), 1)), http.StatusOK)
	if edited.OpenedAt != nil {
		t.Fatalf("editing set opened_at: %v", edited.OpenedAt)
	}
	opened := decodePoll(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/polls/"+draft.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, edited.Version)), http.StatusOK)
	if opened.OpenedAt == nil || opened.OpenedAt.Before(draft.CreatedAt) || time.Since(*opened.OpenedAt) > time.Minute {
		t.Fatalf("opened_at after opening: %v (created %v)", opened.OpenedAt, draft.CreatedAt)
	}
	if listed, _ := listedPoll(t, app, pool, MiaID, draft.ID); listed.OpenedAt == nil || !listed.OpenedAt.Equal(*opened.OpenedAt) {
		t.Fatalf("listed opened_at %v differs from status response %v", listed.OpenedAt, opened.OpenedAt)
	}
	time.Sleep(20 * time.Millisecond) // now() would differ if closing rewrote opened_at
	closed := decodePoll(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/polls/"+draft.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, opened.Version)), http.StatusOK)
	if closed.OpenedAt == nil || !closed.OpenedAt.Equal(*opened.OpenedAt) {
		t.Fatalf("closing changed opened_at: %v -> %v", opened.OpenedAt, closed.OpenedAt)
	}
	if listed, _ := listedPoll(t, app, pool, ManagerID, draft.ID); listed.OpenedAt == nil || !listed.OpenedAt.Equal(*opened.OpenedAt) || !listed.CreatedAt.Equal(draft.CreatedAt) {
		t.Fatalf("listed timeline changed after closing: created=%v opened=%v", listed.CreatedAt, listed.OpenedAt)
	}
}

func TestPollBallotCountIsEditorOnlyAndCountsVoters(t *testing.T) {
	app, pool := timelineApp(t)
	poll := "30000000-0000-4000-8000-000000000001" // seeded, open
	options := []string{"40000000-0000-4000-8000-000000000101", "40000000-0000-4000-8000-000000000102"}
	count := func(userID string) (*int, string) {
		p, raw := listedPoll(t, app, pool, userID, poll)
		return p.BallotCount, string(raw["ballot_count"])
	}
	for _, id := range []string{AdminID, ManagerID} {
		if n, _ := count(id); n == nil || *n != 0 {
			t.Fatalf("editor %s sees initial count %v, want 0", id, n)
		}
	}
	var versionBefore int
	if err := pool.QueryRow(context.Background(), "SELECT version FROM polls WHERE id=$1", poll).Scan(&versionBefore); err != nil {
		t.Fatal(err)
	}
	vote := func(userID, option string) {
		t.Helper()
		res := authenticatedRequest(t, app, pool, userID, http.MethodPut, "/api/v1/polls/"+poll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, option))
		if res.Code != http.StatusOK {
			t.Fatalf("vote status=%d: %s", res.Code, res.Body)
		}
	}
	vote(MiaID, options[0])
	vote(LeonID, options[0])
	vote(MiaID, options[1]) // changing a vote must not add a ballot
	vote(MiaID, options[1]) // repeating it must not either
	for _, id := range []string{AdminID, ManagerID} {
		if n, _ := count(id); n == nil || *n != 2 {
			t.Fatalf("editor %s sees count %v, want 2 voters", id, n)
		}
	}
	for _, id := range []string{MiaID, LeonID, GuestID} {
		if n, raw := count(id); n != nil || raw != "null" {
			t.Fatalf("student %s learned turnout: %s", id, raw)
		}
	}
	var versionAfter int
	if err := pool.QueryRow(context.Background(), "SELECT version FROM polls WHERE id=$1", poll).Scan(&versionAfter); err != nil || versionAfter != versionBefore {
		t.Fatalf("voting changed poll version %d -> %d (%v)", versionBefore, versionAfter, err)
	}
	// Responses to editor writes carry the count; no student endpoint returns it.
	status := decodePoll(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/polls/"+poll+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, versionAfter)), http.StatusOK)
	if status.BallotCount == nil || *status.BallotCount != 2 {
		t.Fatalf("status response count = %v, want 2", status.BallotCount)
	}
	for _, id := range []string{MiaID, LeonID} {
		if n, raw := count(id); n != nil || raw != "null" {
			t.Fatalf("student %s learned turnout after closing: %s", id, raw)
		}
	}
}

func TestPollTimelineMigrationBackfillsExistingPolls(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	// Rewind the schema to its pre-002 shape with polls already present.
	for _, q := range []string{
		"ALTER TABLE polls DROP COLUMN created_at, DROP COLUMN opened_at",
		"DELETE FROM schema_migrations WHERE version='002_poll_timeline.sql'",
		"INSERT INTO categories(id,name,kind) VALUES('" + categoryID(1) + "','Ideen','idea')",
		"INSERT INTO polls(id,category_id,title,kind,status) VALUES('30000000-0000-4000-8000-000000000001','" + categoryID(1) + "','draft','proposal','draft'),('30000000-0000-4000-8000-000000000002','" + categoryID(1) + "','open','proposal','open'),('30000000-0000-4000-8000-000000000003','" + categoryID(1) + "','closed','proposal','closed')",
		// The open poll has history: saved 10 days ago, opened 7 days ago. The closed one has none.
		"INSERT INTO users(id,subject,name) VALUES('30000000-0000-4000-8000-0000000000aa','migration-actor','Actor')",
		"INSERT INTO audit_events(id,actor_id,action,entity_id,created_at) VALUES('30000000-0000-4000-8000-0000000000b1','30000000-0000-4000-8000-0000000000aa','poll.saved','30000000-0000-4000-8000-000000000002',now()-interval '10 days'),('30000000-0000-4000-8000-0000000000b2','30000000-0000-4000-8000-0000000000aa','poll.status.open','30000000-0000-4000-8000-000000000002',now()-interval '7 days')",
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate existing database: %v", err)
	}
	rows, err := pool.Query(ctx, "SELECT title,created_at,opened_at FROM polls")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var title string
		var created time.Time
		var opened *time.Time
		if err := rows.Scan(&title, &created, &opened); err != nil {
			t.Fatal(err)
		}
		n++
		switch {
		case title == "draft" && opened != nil:
			t.Fatalf("draft got opened_at %v", opened)
		case title != "draft" && (opened == nil || opened.Before(created)):
			t.Fatalf("%s poll opened_at=%v, want non-null and not before created_at %v", title, opened, created)
		case title == "open" && (time.Since(created) < 9*24*time.Hour || time.Since(*opened) < 6*24*time.Hour || time.Since(*opened) > 8*24*time.Hour):
			t.Fatalf("open poll created_at=%v opened_at=%v, want times from the audit log", created, opened)
		}
	}
	if n != 3 {
		t.Fatalf("saw %d polls, want 3", n)
	}
}

func TestSeededPollsHaveStaggeredTimeline(t *testing.T) {
	app, pool := timelineApp(t)
	seen := map[time.Time]bool{}
	for _, id := range []string{"30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"} {
		p, _ := listedPoll(t, app, pool, ManagerID, id)
		if p.OpenedAt == nil || p.OpenedAt.Before(p.CreatedAt) || seen[*p.OpenedAt] {
			t.Fatalf("seeded poll %s timeline created=%v opened=%v", id, p.CreatedAt, p.OpenedAt)
		}
		seen[*p.OpenedAt] = true
	}
	if p, _ := listedPoll(t, app, pool, ManagerID, "30000000-0000-4000-8000-000000000003"); p.OpenedAt != nil {
		t.Fatalf("seeded draft has opened_at %v", p.OpenedAt)
	}
}
