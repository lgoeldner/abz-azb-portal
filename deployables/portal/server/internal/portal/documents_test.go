package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests need TEST_DATABASE_URL (disposable PostgreSQL); they skip without it.

type docFixture struct {
	t    *testing.T
	app  *App
	pool *pgxpool.Pool
}

func newDocFixture(t *testing.T) *docFixture {
	t.Helper()
	app, pool := timelineApp(t)
	return &docFixture{t, app, pool}
}

func (f *docFixture) user(role string, admitted bool) string {
	f.t.Helper()
	id := ID()
	if _, err := f.pool.Exec(context.Background(), "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,$2,$3,$4,$5,true)", id, "doc-test-"+id, "Doc "+id[:8], role, admitted); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *docFixture) expect(actor, method, path string, body any, want int) []byte {
	f.t.Helper()
	raw := ""
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			f.t.Fatal(err)
		}
		raw = string(b)
	}
	res := authenticatedRequest(f.t, f.app, f.pool, actor, method, path, raw)
	if res.Code != want {
		f.t.Fatalf("%s %s as %s: status=%d want %d: %s", method, path, actor, res.Code, want, res.Body)
	}
	return res.Body.Bytes()
}

func (f *docFixture) decode(raw []byte, v any) {
	f.t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		f.t.Fatalf("decode %s: %v", raw, err)
	}
}

func (f *docFixture) create(actor string, over map[string]any) Document {
	f.t.Helper()
	b := map[string]any{"title": "Treffen", "kind": "meeting", "body": "Agenda"}
	for k, v := range over {
		b[k] = v
	}
	var d Document
	f.decode(f.expect(actor, http.MethodPost, "/api/v1/documents", b, 201), &d)
	return d
}

func (f *docFixture) get(actor, id string) Document {
	f.t.Helper()
	var d Document
	f.decode(f.expect(actor, http.MethodGet, "/api/v1/documents/"+id, nil, 200), &d)
	return d
}

// edit sends the document's own fields with over applied; it decodes the result only for a 200.
func (f *docFixture) edit(actor string, d Document, over map[string]any, want int) Document {
	f.t.Helper()
	b := map[string]any{"title": d.Title, "kind": d.Kind, "body": d.Body, "version": d.Version}
	for k, v := range over {
		b[k] = v
	}
	out := f.expect(actor, http.MethodPatch, "/api/v1/documents/"+d.ID, b, want)
	var e Document
	if want == 200 {
		f.decode(out, &e)
	}
	return e
}

func (f *docFixture) unread(actor, id string) bool {
	f.t.Helper()
	var list []Document
	f.decode(f.expect(actor, http.MethodGet, "/api/v1/documents", nil, 200), &list)
	for _, d := range list {
		if d.ID == id {
			return d.Unread
		}
	}
	f.t.Fatalf("document %s missing from list", id)
	return false
}

// row reads the persisted state, bypassing the API.
func (f *docFixture) row(id string) (title, body string, version int, exists bool) {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(), "SELECT title,body,version FROM documents WHERE id=$1", id)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		if err = rows.Scan(&title, &body, &version); err != nil {
			f.t.Fatal(err)
		}
		exists = true
	}
	return
}

func TestDocumentRoutesAreForManagersAndAdminsOnly(t *testing.T) {
	f := newDocFixture(t)
	pending := f.user("manager", false)
	id := docID(1)
	for _, actor := range []string{MiaID, GuestID, pending} {
		f.expect(actor, http.MethodGet, "/api/v1/documents", nil, 403)
		f.expect(actor, http.MethodPost, "/api/v1/documents", map[string]any{"title": "x", "kind": "note", "body": ""}, 403)
		f.expect(actor, http.MethodGet, "/api/v1/documents/"+id, nil, 403)
		f.expect(actor, http.MethodPatch, "/api/v1/documents/"+id, map[string]any{"title": "x", "kind": "note", "body": "", "version": 1}, 403)
		f.expect(actor, http.MethodDelete, "/api/v1/documents/"+id, map[string]any{"version": 1}, 403)
	}
	if title, _, version, ok := f.row(id); !ok || title != "Treffen 18.11." || version != 1 {
		t.Fatalf("denied requests changed the document: %q v%d exists=%v", title, version, ok)
	}
	f.expect(ManagerID, http.MethodGet, "/api/v1/documents/"+id, nil, 200)
	f.expect(AdminID, http.MethodGet, "/api/v1/documents", nil, 200)
	f.expect(AdminID, http.MethodGet, "/api/v1/documents/"+ID(), nil, 404)
	f.expect(AdminID, http.MethodGet, "/api/v1/documents/not-a-uuid", nil, 404)
}

func TestStaleDocumentWritesConflictAndLeaveRowUnchanged(t *testing.T) {
	f := newDocFixture(t)
	m1, m2 := f.user("manager", true), f.user("manager", true)
	d := f.create(m1, nil)
	updated := f.edit(m2, d, map[string]any{"title": "Neu", "body": "Zwei"}, 200)
	if updated.Version != d.Version+1 || updated.UpdatedBy.ID != m2 || !updated.UpdatedAt.After(d.UpdatedAt) {
		t.Fatalf("edit did not bump version, editor and time: %+v", updated)
	}
	f.edit(m1, d, map[string]any{"title": "Stale", "body": "Stale"}, 409)
	f.expect(m1, http.MethodDelete, "/api/v1/documents/"+d.ID, map[string]any{"version": d.Version}, 409)
	f.expect(AdminID, http.MethodDelete, "/api/v1/documents/"+d.ID, map[string]any{"version": d.Version}, 409)
	if title, body, version, ok := f.row(d.ID); !ok || title != "Neu" || body != "Zwei" || version != updated.Version {
		t.Fatalf("stale writes changed the row: %q %q v%d exists=%v", title, body, version, ok)
	}
}

func TestDocumentUnreadFollowsOtherPeoplesChanges(t *testing.T) {
	f := newDocFixture(t)
	m1, m2 := f.user("manager", true), f.user("manager", true)

	d := f.create(m1, nil)
	if d.Unread || f.unread(m1, d.ID) {
		t.Fatal("own create is unread for the author")
	}
	if !f.unread(m2, d.ID) {
		t.Fatal("a new document by someone else is not unread")
	}
	if got := f.get(m2, d.ID); got.Unread || f.unread(m2, d.ID) {
		t.Fatal("opening the document did not clear unread")
	}

	edited := f.edit(m2, d, map[string]any{"body": "Ergebnis"}, 200)
	if edited.Unread || f.unread(m2, d.ID) {
		t.Fatal("own edit made the document unread for the editor")
	}
	if !f.unread(m1, d.ID) {
		t.Fatal("another manager's edit did not make the document unread")
	}
	if got := f.get(m1, d.ID); got.Unread || got.Body != "Ergebnis" || f.unread(m1, d.ID) {
		t.Fatal("opening did not clear unread")
	}

	own := f.edit(m1, edited, map[string]any{"body": "Ergänzt"}, 200)
	if own.Unread || f.unread(m1, d.ID) {
		t.Fatal("own edit after reading made the document unread for the editor")
	}
	if !f.unread(m2, d.ID) {
		t.Fatal("the other manager was not notified of the change")
	}

	// An edit whose transaction began before the reader's but committed after it carries an updated_at older than
	// the reader's wall clock. It must still show as unread, so the view is pinned to the row that was read.
	f.get(m2, d.ID)
	if _, err := f.pool.Exec(context.Background(), "UPDATE documents SET updated_by=$2,version=version+1,updated_at=updated_at+interval '1 microsecond' WHERE id=$1", d.ID, m1); err != nil {
		t.Fatal(err)
	}
	if !f.unread(m2, d.ID) {
		t.Fatal("an edit committed after the read but stamped before it was not shown as unread")
	}
}

func TestDocumentDeleteIsForCreatorAndAdmins(t *testing.T) {
	f := newDocFixture(t)
	creator, other := f.user("manager", true), f.user("manager", true)
	d := f.create(creator, nil)
	f.expect(other, http.MethodDelete, "/api/v1/documents/"+d.ID, map[string]any{"version": d.Version}, 403)
	if _, _, _, ok := f.row(d.ID); !ok {
		t.Fatal("a non-creator manager deleted the document")
	}
	// Another manager's edit does not transfer ownership.
	edited := f.edit(other, d, nil, 200)
	f.expect(other, http.MethodDelete, "/api/v1/documents/"+d.ID, map[string]any{"version": edited.Version}, 403)
	f.get(other, d.ID)
	f.expect(creator, http.MethodDelete, "/api/v1/documents/"+d.ID, map[string]any{"version": edited.Version}, 204)
	if _, _, _, ok := f.row(d.ID); ok {
		t.Fatal("creator delete did not remove the document")
	}
	var views int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM document_views WHERE document_id=$1", d.ID).Scan(&views); err != nil || views != 0 {
		t.Fatalf("views of a deleted document remain: %d %v", views, err)
	}
	f.expect(creator, http.MethodGet, "/api/v1/documents/"+d.ID, nil, 404)

	byAdmin := f.create(creator, nil)
	f.expect(AdminID, http.MethodDelete, "/api/v1/documents/"+byAdmin.ID, map[string]any{"version": byAdmin.Version}, 204)
	if _, _, _, ok := f.row(byAdmin.ID); ok {
		t.Fatal("admin delete did not remove the document")
	}
}

func TestDocumentValidation(t *testing.T) {
	f := newDocFixture(t)
	d := f.create(ManagerID, nil)
	cases := map[string]map[string]any{
		"empty title":      {"title": ""},
		"blank title":      {"title": " \t "},
		"overlong title":   {"title": strings.Repeat("a", 201)},
		"unknown kind":     {"kind": "protokoll"},
		"empty kind":       {"kind": ""},
		"overlong body":    {"body": strings.Repeat("b", 100001)},
		"NUL in the title": {"title": "a\x00b"},
	}
	for name, over := range cases {
		b := map[string]any{"title": "Titel", "kind": "note", "body": ""}
		for k, v := range over {
			b[k] = v
		}
		f.expect(ManagerID, http.MethodPost, "/api/v1/documents", b, 400)
		f.edit(ManagerID, d, over, 400)
		if title, body, version, _ := f.row(d.ID); title != d.Title || body != d.Body || version != d.Version {
			t.Fatalf("%s: rejected edit changed the row", name)
		}
	}
	// The limits count characters, not bytes.
	f.create(ManagerID, map[string]any{"title": strings.Repeat("ä", 200), "kind": "note", "body": strings.Repeat("ö", 100000)})
	if got := f.create(ManagerID, map[string]any{"title": "  Getrimmt  "}); got.Title != "Getrimmt" {
		t.Fatalf("title not trimmed: %q", got.Title)
	}
}

func TestProjectManagementFlagGatesDocumentRoutes(t *testing.T) {
	f := newDocFixture(t)
	cfg := f.app.Config
	cfg.ProjectManagement = false
	off, err := New(context.Background(), cfg, f.pool)
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, rt := range off.apiRoutes() {
		if !projectRoute(rt.Pattern) {
			continue
		}
		method, path, _ := strings.Cut(rt.Pattern, " ")
		body := ""
		if method != http.MethodGet {
			body = "{}"
		}
		if res := authenticatedRequest(t, off, f.pool, AdminID, method, concretePath(path), body); res.Code != 404 {
			t.Errorf("%s %s with the flag off: status=%d want 404", method, path, res.Code)
		}
		checked++
	}
	if checked < 10 {
		t.Fatalf("only %d project routes found", checked)
	}
	var me map[string]any
	res := authenticatedRequest(t, off, f.pool, AdminID, http.MethodGet, "/api/v1/me", "")
	if err = json.Unmarshal(res.Body.Bytes(), &me); err != nil || res.Code != 200 {
		t.Fatalf("/me with the flag off: %d %v", res.Code, err)
	}
	if _, present := me["project_management"]; present {
		t.Fatal("/me exposes project_management with the flag off")
	}
	// The flag only hides the feature: routes outside it keep working.
	if res = authenticatedRequest(t, off, f.pool, AdminID, http.MethodGet, "/api/v1/categories", ""); res.Code != 200 {
		t.Fatalf("categories with the flag off: %d", res.Code)
	}

	res = authenticatedRequest(t, f.app, f.pool, AdminID, http.MethodGet, "/api/v1/me", "")
	me = nil
	if err = json.Unmarshal(res.Body.Bytes(), &me); err != nil || me["project_management"] != true {
		t.Fatalf("/me with the flag on: %s", res.Body)
	}
}

func TestErasureDropsDocumentViewsAndKeepsDocuments(t *testing.T) {
	f := newDocFixture(t)
	ctx := context.Background()
	leaver, stayer := f.user("manager", true), f.user("manager", true)
	written := f.create(leaver, nil)
	other := f.create(stayer, nil)
	f.get(leaver, other.ID)
	f.get(stayer, written.ID)
	count := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := f.pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if count("SELECT count(*) FROM document_views WHERE user_id=$1", leaver) != 1 {
		t.Fatal("fixture: leaver has no view")
	}
	var out bytes.Buffer
	if err := RunEraseCommand(ctx, f.pool, f.app.Config, []string{"--id", leaver, "--apply"}, &out); err != nil {
		t.Fatalf("erase: %v %s", err, out.String())
	}
	if n := count("SELECT count(*) FROM document_views WHERE user_id=$1", leaver); n != 0 {
		t.Fatalf("erased user still has %d document views", n)
	}
	if n := count("SELECT count(*) FROM document_views WHERE user_id=$1", stayer); n != 1 {
		t.Fatalf("erasure touched another user's views: %d", n)
	}
	got := f.get(stayer, written.ID)
	if got.Title != written.Title || got.Body != written.Body || got.CreatedBy.ID != leaver || got.CreatedBy.Name != erasedName {
		t.Fatalf("document did not survive as a tombstoned team record: %+v", got)
	}
	if n := count("SELECT count(*) FROM documents WHERE id=ANY($1)", []string{written.ID, other.ID}); n != 2 {
		t.Fatalf("documents lost in erasure: %d", n)
	}
}

func TestUserWhoWroteOrEditedADocumentCannotBeHardDeleted(t *testing.T) {
	f := newDocFixture(t)
	author, editor, bystander := f.user("manager", true), f.user("manager", true), f.user("manager", true)
	d := f.create(author, nil)
	f.edit(editor, d, map[string]any{"body": "x"}, 200)
	for _, id := range []string{author, editor} {
		f.expect(AdminID, http.MethodDelete, "/api/v1/admin/users/"+id, nil, 409)
	}
	f.expect(AdminID, http.MethodDelete, "/api/v1/admin/users/"+bystander, nil, 204)
}
