package portal

import (
	"abizeitbetrug/auth-mock/authmock"
	"abizeitbetrug/server/migrations"
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	pollOpen   = "30000000-0000-4000-8000-000000000001" // seeded: proposal, open
	pollPerson = "30000000-0000-4000-8000-000000000002" // seeded: person, open
	pollDraft  = "30000000-0000-4000-8000-000000000003" // seeded: proposal, draft
)

func submissionBody(category string) string {
	return fmt.Sprintf(`{"idempotency_key":"key-%s-12345","category_id":%q,"title":"T","body":"B","context":""}`, category[:8], category)
}

func categoriesFor(t *testing.T, app *App, userID string) map[string]Category {
	t.Helper()
	res := authenticatedRequest(t, app, app.DB, userID, http.MethodGet, "/api/v1/categories", "")
	if res.Code != http.StatusOK {
		t.Fatalf("list as %s: %d %s", userID, res.Code, res.Body)
	}
	var list []Category
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	out := map[string]Category{}
	for _, c := range list {
		out[c.ID] = c
	}
	return out
}

func TestSubmissionsRequireRepeatableCategoryAndBallotsRequireSingleAnswer(t *testing.T) {
	app, pool := timelineApp(t)
	// Submission into a single-answer category: rejected on create and on category change.
	for _, c := range []string{pollOpen, pollDraft} {
		if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionBody(c)); res.Code != http.StatusBadRequest {
			t.Fatalf("create in single-answer category %s: %d %s", c, res.Code, res.Body)
		}
	}
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM submissions WHERE category_id=ANY($1::uuid[])", []string{pollOpen, pollDraft}).Scan(&n); err != nil || n != 0 {
		t.Fatalf("submissions in single-answer categories: %d (%v)", n, err)
	}
	// Moving an own pending submission into a single-answer category is rejected too.
	sub := "20000000-0000-4000-8000-000000000001" // Mia's pending idea
	res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub, fmt.Sprintf(`{"version":1,"category_id":%q,"title":"T","body":"B","context":""}`, pollOpen))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("category change into poll: %d %s", res.Code, res.Body)
	}
	// Unknown categories stay a validation error.
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionBody("99999999-0000-4000-8000-000000000009")); res.Code != http.StatusBadRequest {
		t.Fatalf("create in unknown category: %d", res.Code)
	}
	// Ballot-side routes reject repeatable categories for everyone allowed to call them.
	rep := categoryID(1)
	opt := "40000000-0000-4000-8000-000000000101"
	for _, tc := range []struct{ actor, method, path, body string }{
		{MiaID, http.MethodPut, "/ballot", fmt.Sprintf(`{"option_id":%q}`, opt)},
		{AdminID, http.MethodPost, "/status", `{"version":1,"status":"closed"}`},
		{ManagerID, http.MethodPost, "/status", `{"version":1,"status":"closed"}`},
		{AdminID, http.MethodGet, "/results", ""},
		{AdminID, http.MethodGet, "/audit", ""},
	} {
		if res := authenticatedRequest(t, app, pool, tc.actor, tc.method, "/api/v1/categories/"+rep+tc.path, tc.body); res.Code != http.StatusBadRequest {
			t.Errorf("%s %s as %s on repeatable category: %d %s", tc.method, tc.path, tc.actor, res.Code, res.Body)
		}
	}
	// Exports cover repeatable categories only.
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+pollOpen+"/export", ""); res.Code != http.StatusBadRequest {
		t.Fatalf("export of single-answer category: %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+rep+"/export?status=all", ""); res.Code != http.StatusOK {
		t.Fatalf("export of repeatable category: %d", res.Code)
	}
	readExportCSV := func(resBody []byte) string {
		t.Helper()
		archive, err := zip.NewReader(bytes.NewReader(resBody), int64(len(resBody)))
		if err != nil {
			t.Fatalf("read export ZIP: %v", err)
		}
		for _, file := range archive.File {
			if file.Name != "submissions.csv" {
				continue
			}
			entry, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(entry)
			entry.Close()
			if err != nil {
				t.Fatal(err)
			}
			return string(data)
		}
		t.Fatal("export ZIP has no submissions.csv")
		return ""
	}
	defaultExport := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+rep+"/export", "")
	if defaultExport.Code != http.StatusOK || !strings.Contains(readExportCSV(defaultExport.Body.Bytes()), "Eine Playlist für unseren Jahrgang") {
		t.Fatalf("default export did not include pending submissions: status=%d", defaultExport.Code)
	}
	acceptedExport := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+rep+"/export?status=accepted", "")
	if acceptedExport.Code != http.StatusOK || strings.Contains(readExportCSV(acceptedExport.Body.Bytes()), "Eine Playlist für unseren Jahrgang") {
		t.Fatalf("explicit accepted export included a pending submission: status=%d", acceptedExport.Code)
	}
}

func TestCategoryVisibilityByRole(t *testing.T) {
	app, pool := timelineApp(t)
	for _, student := range []string{MiaID, LeonID, GuestID} {
		cats := categoriesFor(t, app, student)
		if _, ok := cats[pollDraft]; ok {
			t.Fatalf("%s sees a draft category", student)
		}
		if _, ok := cats[pollOpen]; !ok || cats[categoryID(1)].ID == "" {
			t.Fatalf("%s misses open categories", student)
		}
		for _, c := range cats {
			if c.Status == "draft" || c.BallotCount != nil {
				t.Fatalf("%s sees %s status=%s count=%v", student, c.ID, c.Status, c.BallotCount)
			}
		}
		// Direct access to a draft is hidden as well.
		if res := authenticatedRequest(t, app, pool, student, http.MethodPut, "/api/v1/categories/"+pollDraft+"/ballot", `{"option_id":"40000000-0000-4000-8000-000000000301"}`); res.Code != http.StatusNotFound {
			t.Fatalf("%s voting in a draft: %d", student, res.Code)
		}
	}
	for _, editorID := range []string{ManagerID, AdminID} {
		cats := categoriesFor(t, app, editorID)
		if cats[pollDraft].ID == "" || cats[pollOpen].BallotCount == nil {
			t.Fatalf("%s misses draft or count", editorID)
		}
		if c := cats[categoryID(1)]; !c.Repeatable || c.Status != "open" || c.BallotCount != nil || c.MyOptionID != nil || len(c.Options) != 0 {
			t.Fatalf("repeatable category payload: %+v", c)
		}
	}
	if c := categoriesFor(t, app, MiaID)[pollOpen]; c.Repeatable || len(c.Options) != 3 {
		t.Fatalf("single-answer payload: %+v", c)
	}
	// Results are for editors, the named audit for admins only.
	for _, tc := range []struct {
		actor, path string
		want        int
	}{
		{MiaID, "/results", 403}, {GuestID, "/results", 403}, {ManagerID, "/results", 200}, {AdminID, "/results", 200},
		{MiaID, "/audit", 403}, {ManagerID, "/audit", 403}, {AdminID, "/audit", 200},
	} {
		if res := authenticatedRequest(t, app, pool, tc.actor, http.MethodGet, "/api/v1/categories/"+pollOpen+tc.path, ""); res.Code != tc.want {
			t.Errorf("%s%s as %s: %d, want %d", pollOpen, tc.path, tc.actor, res.Code, tc.want)
		}
	}
}

func TestManagerCreatesAndOwnsSingleAnswerCategories(t *testing.T) {
	app, pool := timelineApp(t)
	ctx := context.Background()
	body := `{"name":"Lieblingslehrkraft","description":"","kind":"proposal","allow_self_vote":false,"options":[{"label":"A"},{"label":"B"}]}`
	created := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)
	if created.Status != "draft" || created.Repeatable || created.OpenedAt != nil {
		t.Fatalf("created: %+v", created)
	}
	var granted bool
	if err := pool.QueryRow(ctx, "SELECT $1::uuid=ANY(category_ids) FROM users WHERE id=$2", created.ID, ManagerID).Scan(&granted); err != nil || !granted {
		t.Fatalf("creator was not granted the new category (%v)", err)
	}
	edit := strings.Replace(body, `"options"`, fmt.Sprintf(`"version":%d,"options"`, created.Version), 1)
	edited := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+created.ID, strings.Replace(edit, "Lieblingslehrkraft", "Lieblingsfach", 1)), http.StatusOK)
	if edited.Name != "Lieblingsfach" || edited.Version != created.Version+1 {
		t.Fatalf("edited: %+v", edited)
	}
	// A stale version is a conflict, for single-answer and repeatable categories alike.
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+created.ID, edit); res.Code != http.StatusConflict {
		t.Fatalf("stale single-answer edit: %d", res.Code)
	}
	repBody := `{"name":"Zitate neu","description":"","kind":"quote","version":%d}`
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+categoryID(2), fmt.Sprintf(repBody, 99)); res.Code != http.StatusConflict {
		t.Fatalf("stale repeatable edit: %d", res.Code)
	}
	rep := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+categoryID(2), fmt.Sprintf(repBody, 1)), http.StatusOK)
	if rep.Version != 2 || rep.Name != "Zitate neu" || rep.Status != "open" {
		t.Fatalf("repeatable edit: %+v", rep)
	}
	opened := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories/"+created.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, edited.Version)), http.StatusOK)
	if opened.Status != "open" || opened.OpenedAt == nil {
		t.Fatalf("opened: %+v", opened)
	}
	// Once open, the definition is frozen.
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+created.ID, strings.Replace(edit, `"version":1`, fmt.Sprintf(`"version":%d`, opened.Version), 1)); res.Code != http.StatusConflict {
		t.Fatalf("edit of open category: %d", res.Code)
	}
	// Managers cannot create repeatable categories nor edit ones they are not granted.
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories", `{"name":"Neu","description":"","kind":"idea"}`); res.Code != http.StatusForbidden {
		t.Fatalf("manager created repeatable category: %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+categoryID(1), fmt.Sprintf(`{"name":"X","description":"","kind":"idea","version":%d}`, 1)); res.Code != http.StatusForbidden {
		t.Fatalf("manager edited repeatable category: %d", res.Code)
	}
	// An admin-created single-answer category is not editable by a manager without a grant.
	adminMade := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+adminMade.ID, strings.Replace(edit, `"version":1`, fmt.Sprintf(`"version":%d`, adminMade.Version), 1)); res.Code != http.StatusForbidden {
		t.Fatalf("ungranted manager edit: %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories/"+adminMade.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, adminMade.Version)); res.Code != http.StatusForbidden {
		t.Fatalf("ungranted manager status change: %d", res.Code)
	}
	// Students cannot create anything.
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/categories", body); res.Code != http.StatusForbidden {
		t.Fatalf("student create: %d", res.Code)
	}
}

func TestCategoryKindChangesStayWithinTheirGroup(t *testing.T) {
	app, pool := timelineApp(t)
	// repeatable -> single-answer
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+categoryID(1), `{"name":"X","description":"","kind":"proposal","version":1,"options":[{"label":"A"},{"label":"B"}]}`); res.Code != http.StatusBadRequest {
		t.Fatalf("repeatable to single-answer: %d %s", res.Code, res.Body)
	}
	// single-answer (draft) -> repeatable
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+pollDraft, `{"name":"X","description":"","kind":"memory","version":1}`); res.Code != http.StatusBadRequest {
		t.Fatalf("single-answer to repeatable: %d %s", res.Code, res.Body)
	}
	// Within a group it works.
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+categoryID(1), `{"name":"Fotos 2","description":"","kind":"photo","version":1}`); res.Code != http.StatusOK {
		t.Fatalf("idea to photo: %d %s", res.Code, res.Body)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+pollDraft, `{"name":"X","description":"","kind":"person","version":1,"options":[{"label":"x","user_id":"`+MiaID+`"},{"label":"y","user_id":"`+LeonID+`"}]}`); res.Code != http.StatusOK {
		t.Fatalf("proposal to person: %d %s", res.Code, res.Body)
	}
}

// migrateTo applies the embedded migrations up to and including the given file on an empty schema.
func migrateTo(t *testing.T, last string) (*pgxpool.Pool, string) {
	t.Helper()
	ctx := context.Background()
	pool := emptySchemaPool(t)
	if _, err := pool.Exec(ctx, "CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		t.Fatal(err)
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".sql") || f.Name() > last {
			continue
		}
		sql, _ := migrations.Files.ReadFile(f.Name())
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", f.Name(), err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", f.Name()); err != nil {
			t.Fatal(err)
		}
	}
	provider := mockProvider(t, "", "http://localhost:8080", []authmock.User{{Subject: FixtureSubject(MiaID), Name: "Mia", DisplaySlug: "mia_weber"}})
	return pool, provider.URL
}

func TestMigration004TurnsPollsIntoCategoriesKeepingBallots(t *testing.T) {
	pool, issuer := migrateTo(t, "003_user_created_at.sql")
	ctx := context.Background()
	const (
		cat, poll, draft, lone = "10000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-0000000000a1", "30000000-0000-4000-8000-0000000000a2", "30000000-0000-4000-8000-0000000000a3"
		mgr, other, ann, bob   = "50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002", "50000000-0000-4000-8000-000000000003", "50000000-0000-4000-8000-000000000004"
		o1, o2, d1, d2         = "60000000-0000-4000-8000-000000000001", "60000000-0000-4000-8000-000000000002", "60000000-0000-4000-8000-000000000003", "60000000-0000-4000-8000-000000000004"
	)
	for _, q := range []string{
		"INSERT INTO categories(id,name,description,kind) VALUES('" + cat + "','Ideen','Ideen-Sammlung','idea')",
		"INSERT INTO users(id,subject,name,role,admitted,cohort_member,category_ids) VALUES('" + mgr + "','m','Mgr','manager',true,true,'{" + cat + "}'),('" + other + "','o','Other','manager',true,true,'{}'),('" + ann + "','a','Ann','student',true,true,'{}'),('" + bob + "','b','Bob','student',true,true,'{}')",
		"INSERT INTO submissions(id,category_id,author_id,title,idempotency_key,request_hash) VALUES('70000000-0000-4000-8000-000000000001','" + cat + "','" + ann + "','Idee','k-12345678','h')",
		"INSERT INTO polls(id,category_id,title,description,kind,status,allow_self_vote,version,created_at,opened_at) VALUES('" + poll + "','" + cat + "','Motto','Beschreibung','proposal','open',true,4,now()-interval '10 days',now()-interval '7 days'),('" + draft + "','" + cat + "','Cover','','proposal','draft',false,1,now()-interval '2 days',NULL)",
		"INSERT INTO polls(id,category_id,title,kind,status) SELECT '" + lone + "',id,'Closed','person','closed' FROM categories WHERE id='" + cat + "'",
		"INSERT INTO poll_options(id,poll_id,label,position) VALUES('" + o1 + "','" + poll + "','Eins',0),('" + o2 + "','" + poll + "','Zwei',1),('" + d1 + "','" + draft + "','Blau',0),('" + d2 + "','" + draft + "','Gelb',1)",
		"INSERT INTO ballots(poll_id,user_id,option_id) VALUES('" + poll + "','" + ann + "','" + o1 + "'),('" + poll + "','" + bob + "','" + o2 + "')",
		"INSERT INTO ballot_audit(id,poll_id,user_id,option_id) VALUES('80000000-0000-4000-8000-000000000001','" + poll + "','" + ann + "','" + o1 + "'),('80000000-0000-4000-8000-000000000002','" + poll + "','" + bob + "','" + o1 + "'),('80000000-0000-4000-8000-000000000003','" + poll + "','" + bob + "','" + o2 + "')",
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	var created, opened time.Time
	if err := pool.QueryRow(ctx, "SELECT created_at,opened_at FROM polls WHERE id=$1", poll).Scan(&created, &opened); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var gone bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('polls') IS NULL").Scan(&gone); err != nil || !gone {
		t.Fatalf("polls table still exists (%v)", err)
	}

	app := appForPool(t, pool, issuer)
	admin := "50000000-0000-4000-8000-0000000000ad"
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,'adm','Adm','admin',true,true)", admin); err != nil {
		t.Fatal(err)
	}
	// The poll keeps its id and definition; the old repeatable category is open and unchanged.
	got := categoriesFor(t, app, mgr)
	p := got[poll]
	if p.Name != "Motto" || p.Description != "Beschreibung" || p.Kind != "proposal" || p.Repeatable || p.Status != "open" || !p.AllowSelfVote || p.Version != 4 || len(p.Options) != 2 || p.Options[0].Label != "Eins" {
		t.Fatalf("migrated poll: %+v", p)
	}
	if p.OpenedAt == nil || !p.OpenedAt.Equal(opened) || !p.CreatedAt.Equal(created) {
		t.Fatalf("poll timeline changed: created=%v opened=%v, want %v %v", p.CreatedAt, p.OpenedAt, created, opened)
	}
	if p.BallotCount == nil || *p.BallotCount != 2 {
		t.Fatalf("ballot count: %v", p.BallotCount)
	}
	if c := got[cat]; !c.Repeatable || c.Status != "open" || c.Version != 1 || c.OpenedAt == nil || !c.OpenedAt.Equal(c.CreatedAt) {
		t.Fatalf("migrated repeatable category: %+v", c)
	}
	if got[draft].Status != "draft" || got[draft].OpenedAt != nil || got[lone].Status != "closed" || got[lone].Kind != "person" {
		t.Fatalf("migrated draft/closed: %+v / %+v", got[draft], got[lone])
	}
	// Votes and results survived; the named audit history is intact.
	annView := categoriesFor(t, app, ann)
	if annView[poll].MyOptionID == nil || *annView[poll].MyOptionID != o1 || annView[poll].BallotCount != nil {
		t.Fatalf("ann's view: %+v", annView[poll])
	}
	if _, hidden := annView[draft]; hidden {
		t.Fatal("migrated draft is visible to a student")
	}
	var results []PollResult
	res := authenticatedRequest(t, app, pool, mgr, http.MethodGet, "/api/v1/categories/"+poll+"/results", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &results) != nil || len(results) != 2 || results[0].Count != 1 || results[1].Count != 1 {
		t.Fatalf("results: %d %s", res.Code, res.Body)
	}
	var audits []BallotAudit
	res = authenticatedRequest(t, app, pool, admin, http.MethodGet, "/api/v1/categories/"+poll+"/audit", "")
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &audits) != nil || len(audits) != 3 {
		t.Fatalf("audit: %d %s", res.Code, res.Body)
	}
	// Grants: the manager of the former category now holds every migrated poll; others hold nothing.
	var ids []string
	if err := pool.QueryRow(ctx, "SELECT category_ids::text[] FROM users WHERE id=$1", mgr).Scan(&ids); err != nil {
		t.Fatal(err)
	}
	slices.Sort(ids)
	if want := []string{cat, poll, draft, lone}; len(ids) != 4 || !slices.Equal(ids, sortedCopy(want)) {
		t.Fatalf("manager category_ids = %v, want %v", ids, want)
	}
	var otherGrants int
	if err := pool.QueryRow(ctx, "SELECT cardinality(category_ids) FROM users WHERE id=$1", other).Scan(&otherGrants); err != nil || otherGrants != 0 {
		t.Fatalf("unrelated manager got grants: %d (%v)", otherGrants, err)
	}
	// The granted manager can edit the migrated draft and open it; the ungranted one cannot.
	edit := `{"name":"Cover 2","description":"","kind":"proposal","version":1,"options":[{"label":"Blau"},{"label":"Gelb"}]}`
	if res := authenticatedRequest(t, app, pool, other, http.MethodPatch, "/api/v1/categories/"+draft, edit); res.Code != http.StatusForbidden {
		t.Fatalf("ungranted manager edit: %d", res.Code)
	}
	edited := decodeCategory(t, authenticatedRequest(t, app, pool, mgr, http.MethodPatch, "/api/v1/categories/"+draft, edit), http.StatusOK)
	if opened := decodeCategory(t, authenticatedRequest(t, app, pool, mgr, http.MethodPost, "/api/v1/categories/"+draft+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, edited.Version)), http.StatusOK); opened.Status != "open" {
		t.Fatalf("open migrated draft: %+v", opened)
	}
	// Existing submissions of the repeatable category are untouched.
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM submissions WHERE category_id=$1", cat).Scan(&n); err != nil || n != 1 {
		t.Fatalf("submissions: %d (%v)", n, err)
	}
}

func sortedCopy(in []string) []string {
	out := slices.Clone(in)
	slices.Sort(out)
	return out
}
