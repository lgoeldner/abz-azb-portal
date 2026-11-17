package portal

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func createSteckbriefCategory(t *testing.T, app *App, pool *pgxpool.Pool, extra string) Category {
	t.Helper()
	return decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Steckbrief","description":""`+extra+`,"kind":"steckbrief"}`), http.StatusCreated)
}

// steckbriefBody renders answers as the JSON string a client sends in the submission body field.
func steckbriefBody(pairs ...string) string {
	answers := map[string]string{}
	for i := 0; i+1 < len(pairs); i += 2 {
		answers[pairs[i]] = pairs[i+1]
	}
	data, _ := json.Marshal(answers)
	return string(data)
}

func submissionJSON(fields map[string]any) string {
	data, _ := json.Marshal(fields)
	return string(data)
}

func createSteckbrief(t *testing.T, app *App, pool *pgxpool.Pool, user, category, key, title, body string) *httptest.ResponseRecorder {
	t.Helper()
	return authenticatedRequest(t, app, pool, user, http.MethodPost, "/api/v1/submissions", submissionJSON(map[string]any{"category_id": category, "idempotency_key": key, "title": title, "body": body, "context": ""}))
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSteckbriefCategoryDefaultsAndFixedDefinition(t *testing.T) {
	app, pool := timelineApp(t)
	created := createSteckbriefCategory(t, app, pool, "")
	if created.Kind != "steckbrief" || created.Template != "standard" || created.Repeatable || created.Status != "open" || !created.Ongoing {
		t.Fatalf("steckbrief defaults: %+v", created)
	}
	if explicit := createSteckbriefCategory(t, app, pool, `,"template":"standard","repeatable":false`); explicit.Template != "standard" || explicit.Repeatable {
		t.Fatalf("explicit steckbrief definition: %+v", explicit)
	}
	for name, body := range map[string]string{
		"unknown template":      `{"name":"S","description":"","kind":"steckbrief","template":"fancy"}`,
		"repeatable":            `{"name":"S","description":"","kind":"steckbrief","repeatable":true}`,
		"template on idea":      `{"name":"S","description":"","kind":"idea","template":"standard"}`,
		"template on photo":     `{"name":"S","description":"","kind":"photo","template":"standard"}`,
		"template on proposal":  `{"name":"S","description":"","kind":"proposal","template":"standard","options":[{"label":"A"},{"label":"B"}]}`,
		"options on steckbrief": `{"name":"S","description":"","kind":"steckbrief","options":[{"label":"A"}]}`,
	} {
		if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body); res.Code != 400 {
			t.Fatalf("%s: %d %s", name, res.Code, res.Body)
		}
	}
	if n := countRows(t, pool, "SELECT count(*) FROM categories WHERE kind='steckbrief'"); n != 3 {
		t.Fatalf("rejected definitions persisted a category: %d steckbrief categories (seed fixture, default, explicit)", n)
	}
	idea := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Ideen 2","description":"","kind":"idea"}`), http.StatusCreated)
	if idea.Template != "" {
		t.Fatalf("non-steckbrief category has template %q", idea.Template)
	}

	patch := func(id, body string) *httptest.ResponseRecorder {
		return authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+id, body)
	}
	// An omitted template preserves the stored one and the one-off flag.
	edited := decodeCategory(t, patch(created.ID, fmt.Sprintf(`{"name":"Steckbrief neu","description":"d","kind":"steckbrief","version":%d}`, created.Version)), http.StatusOK)
	if edited.Template != "standard" || edited.Repeatable || edited.Name != "Steckbrief neu" || edited.Version != created.Version+1 {
		t.Fatalf("edit preserving template: %+v", edited)
	}
	v := edited.Version
	for name, tc := range map[string]struct{ id, body string }{
		"steckbrief to idea":        {created.ID, `{"name":"S","description":"","kind":"idea","version":%d}`},
		"steckbrief to photo":       {created.ID, `{"name":"S","description":"","kind":"photo","version":%d}`},
		"template change":           {created.ID, `{"name":"S","description":"","kind":"steckbrief","template":"fancy","version":%d}`},
		"template removal via kind": {created.ID, `{"name":"S","description":"","kind":"quote","template":"standard","version":%d}`},
		"repeatable after creation": {created.ID, `{"name":"S","description":"","kind":"steckbrief","repeatable":true,"version":%d}`},
		"deadline on ongoing":       {created.ID, `{"version":%d,"closes_at":"2999-01-01T00:00:00Z"}`},
	} {
		if res := patch(tc.id, fmt.Sprintf(tc.body, v)); res.Code != 400 {
			t.Fatalf("%s: %d %s", name, res.Code, res.Body)
		}
	}
	if res := patch(idea.ID, fmt.Sprintf(`{"name":"S","description":"","kind":"steckbrief","template":"standard","version":%d}`, idea.Version)); res.Code != 400 {
		t.Fatalf("idea to steckbrief: %d %s", res.Code, res.Body)
	}
	if res := patch(idea.ID, fmt.Sprintf(`{"name":"S","description":"","kind":"steckbrief","version":%d}`, idea.Version)); res.Code != 400 {
		t.Fatalf("idea to steckbrief without template: %d %s", res.Code, res.Body)
	}
	var kind, template string
	var version int
	if err := pool.QueryRow(context.Background(), "SELECT kind,template,version FROM categories WHERE id=$1", created.ID).Scan(&kind, &template, &version); err != nil || kind != "steckbrief" || template != "standard" || version != v {
		t.Fatalf("rejected edits changed steckbrief category: %s %s v%d err=%v", kind, template, version, err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT kind,template FROM categories WHERE id=$1", idea.ID).Scan(&kind, &template); err != nil || kind != "idea" || template != "" {
		t.Fatalf("rejected edits changed idea category: %s %s err=%v", kind, template, err)
	}

	// Bounded Steckbrief collections follow the contribution deadline rules and may be opened for submissions.
	bounded := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Befristet","description":"","kind":"steckbrief","ongoing":false,"closes_at":"2999-01-01T00:00:00Z"}`), http.StatusCreated)
	if bounded.Template != "standard" || bounded.Ongoing || bounded.ClosesAt == nil {
		t.Fatalf("bounded steckbrief: %+v", bounded)
	}
}

func TestSteckbriefOnePerAuthorForcedTitleAndEdit(t *testing.T) {
	app, pool := timelineApp(t)
	category := createSteckbriefCategory(t, app, pool, "")
	body := steckbriefBody("lieblingsfach", "Informatik")
	res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionJSON(map[string]any{"category_id": category.ID, "idempotency_key": "steck-mia-0001", "title": "", "body": body, "context": "ignored"}))
	first := decodeSubmission(t, res)
	if res.Code != 201 || first.Title != "Steckbrief" || first.Context != "" || first.Body != body || first.Version != 1 {
		t.Fatalf("create: %d %+v", res.Code, first)
	}
	replay := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionJSON(map[string]any{"category_id": category.ID, "idempotency_key": "steck-mia-0001", "title": "", "body": body, "context": "ignored"}))
	if replay.Code != 200 || decodeSubmission(t, replay).ID != first.ID {
		t.Fatalf("replay: %d %s", replay.Code, replay.Body)
	}
	if res := createSteckbrief(t, app, pool, MiaID, category.ID, "steck-mia-0002", "Zweiter", body); res.Code != 400 {
		t.Fatalf("second steckbrief of one author: %d %s", res.Code, res.Body)
	}
	leon := decodeSubmission(t, createSteckbrief(t, app, pool, LeonID, category.ID, "steck-leon-0001", "Mein eigener Titel", steckbriefBody("lieblingsfach", "Sport")))
	if leon.Title != "Steckbrief" {
		t.Fatalf("client title leaked: %q", leon.Title)
	}
	if n := countRows(t, pool, "SELECT count(*) FROM submissions WHERE category_id=$1", category.ID); n != 2 {
		t.Fatalf("one steckbrief per author: %d rows", n)
	}

	newBody := steckbriefBody("lieblingsfach", "Mathe", "motto", "Läuft")
	edited := decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+first.ID, submissionJSON(map[string]any{"version": 1, "category_id": category.ID, "title": "Hacked", "body": newBody, "context": "x"})))
	if edited.Version != 2 || edited.Title != "Steckbrief" || edited.Context != "" || edited.Body != newBody {
		t.Fatalf("edit: %+v", edited)
	}
	blank := decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+first.ID, submissionJSON(map[string]any{"version": 2, "category_id": category.ID, "title": "", "body": steckbriefBody(), "context": ""})))
	if blank.Version != 3 || blank.Title != "Steckbrief" || blank.Body != "{}" {
		t.Fatalf("edit with blank title and empty answers: %+v", blank)
	}
	// Status transitions work unchanged for this kind.
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/submissions/"+first.ID+"/status", `{"version":3,"status":"accepted"}`); res.Code != 200 {
		t.Fatalf("accept: %d %s", res.Code, res.Body)
	}
	// Other kinds still require a title.
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionJSON(map[string]any{"category_id": categoryID(1), "idempotency_key": "idea-notitle-0001", "title": " ", "body": "x", "context": ""})); res.Code != 400 {
		t.Fatalf("idea without title: %d %s", res.Code, res.Body)
	}
}

func TestSteckbriefBodyShapeRejectionsPersistNothing(t *testing.T) {
	app, pool := timelineApp(t)
	category := createSteckbriefCategory(t, app, pool, "")
	revisionsBefore := countRows(t, pool, "SELECT count(*) FROM revisions")
	manyKeys := func(n int) string {
		pairs := []string{}
		for i := 0; i < n; i++ {
			pairs = append(pairs, fmt.Sprintf("k%d", i), "x")
		}
		return steckbriefBody(pairs...)
	}
	bad := map[string]string{
		"array":          `["a"]`,
		"string":         `"text"`,
		"null":           `null`,
		"empty":          ``,
		"invalid json":   `{"a":`,
		"trailing value": `{} {}`,
		"nested object":  `{"a":{"b":"c"}}`,
		"nested array":   `{"a":["c"]}`,
		"null value":     `{"a":null}`,
		"number value":   `{"a":1}`,
		"bool value":     `{"a":true}`,
		"uppercase key":  `{"Foto":"x"}`,
		"dash key":       `{"a-b":"x"}`,
		"empty key":      `{"":"x"}`,
		"umlaut key":     `{"größe":"x"}`,
		"key too long":   steckbriefBody(strings.Repeat("a", 41), "x"),
		"value too long": steckbriefBody("a", strings.Repeat("ä", 2001)),
		"too many keys":  manyKeys(61),
		"body too large": steckbriefBody("a", strings.Repeat("x", 2000)) + strings.Repeat(" ", 100000),
		"plain prose":    "Mein Steckbrief",
	}
	for name, body := range bad {
		if res := createSteckbrief(t, app, pool, MiaID, category.ID, "steck-bad-"+strings.ReplaceAll(name, " ", "-"), "", body); res.Code != 400 {
			t.Fatalf("create with %s: %d %s", name, res.Code, res.Body)
		}
	}
	if n := countRows(t, pool, "SELECT count(*) FROM submissions WHERE category_id=$1", category.ID) + countRows(t, pool, "SELECT count(*) FROM revisions") - revisionsBefore; n != 0 {
		t.Fatalf("rejected bodies persisted %d rows", n)
	}

	// Boundary values are accepted: 60 keys, 40-character key, 2000 multibyte codepoints.
	good := steckbriefBody("a", strings.Repeat("ä", 2000), strings.Repeat("z", 40), "ok")
	sub := decodeSubmission(t, createSteckbrief(t, app, pool, MiaID, category.ID, "steck-good-0001", "", good))
	for name, body := range bad {
		if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, submissionJSON(map[string]any{"version": 1, "category_id": category.ID, "title": "", "body": body, "context": ""})); res.Code != 400 {
			t.Fatalf("edit with %s: %d %s", name, res.Code, res.Body)
		}
	}
	var stored string
	var version int
	if err := pool.QueryRow(context.Background(), "SELECT body,version FROM submissions WHERE id=$1", sub.ID).Scan(&stored, &version); err != nil || stored != good || version != 1 {
		t.Fatalf("rejected edits changed the steckbrief: version=%d err=%v", version, err)
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, submissionJSON(map[string]any{"version": 1, "category_id": category.ID, "title": "", "body": manyKeys(60), "context": ""})); res.Code != 200 {
		t.Fatalf("60 keys: %d %s", res.Code, res.Body)
	}
	// The body shape rule applies only to Steckbrief collections.
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", submissionJSON(map[string]any{"category_id": categoryID(1), "idempotency_key": "idea-prose-0001", "title": "Idee", "body": "Freitext, kein JSON", "context": ""})); res.Code != 201 {
		t.Fatalf("idea prose body: %d %s", res.Code, res.Body)
	}
}

func TestSteckbriefRejectsMultipartCreationAndMoves(t *testing.T) {
	app, pool := timelineApp(t)
	category := createSteckbriefCategory(t, app, pool, "")
	other := createSteckbriefCategory(t, app, pool, "")
	res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{"category_id": category.ID, "idempotency_key": "steck-multipart-0001", "caption": "foto", "body": steckbriefBody()}, "foto.jpg", testJPEG(t))
	if res.Code != 400 {
		t.Fatalf("multipart creation: %d %s", res.Code, res.Body)
	}
	if n := countRows(t, pool, "SELECT count(*) FROM submissions WHERE category_id=$1", category.ID) + countRows(t, pool, "SELECT count(*) FROM attachments"); n != 0 {
		t.Fatalf("rejected multipart creation persisted %d rows", n)
	}
	if files := storedKeys(t, app.Config); len(files) != 0 {
		t.Fatalf("rejected multipart creation wrote files: %v", files)
	}

	steck := decodeSubmission(t, createSteckbrief(t, app, pool, MiaID, category.ID, "steck-move-0001", "", steckbriefBody("a", "b")))
	idea := decodeSubmission(t, createContribution(t, app, pool, LeonID, categoryID(1), "idea-move-0001", "Idee"))
	for name, tc := range map[string]struct {
		user, id, category string
		version            int
	}{
		"steckbrief to idea":             {MiaID, steck.ID, categoryID(1), steck.Version},
		"steckbrief to other steckbrief": {MiaID, steck.ID, other.ID, steck.Version},
		"idea to steckbrief":             {LeonID, idea.ID, category.ID, idea.Version},
	} {
		body := submissionJSON(map[string]any{"version": tc.version, "category_id": tc.category, "title": "Titel", "body": "{}", "context": ""})
		if res := authenticatedRequest(t, app, pool, tc.user, http.MethodPatch, "/api/v1/submissions/"+tc.id, body); res.Code != 400 {
			t.Fatalf("%s: %d %s", name, res.Code, res.Body)
		}
	}
	var cat string
	var version int
	if err := pool.QueryRow(context.Background(), "SELECT category_id::text,version FROM submissions WHERE id=$1", steck.ID).Scan(&cat, &version); err != nil || cat != category.ID || version != 1 {
		t.Fatalf("rejected move changed steckbrief: %s v%d err=%v", cat, version, err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT category_id::text,version FROM submissions WHERE id=$1", idea.ID).Scan(&cat, &version); err != nil || cat != categoryID(1) || version != 1 {
		t.Fatalf("rejected move changed idea: %s v%d err=%v", cat, version, err)
	}
}

func steckbriefUpload(t *testing.T, app *App, pool *pgxpool.Pool, user string, sub Submission, slot string) *httptest.ResponseRecorder {
	t.Helper()
	return photoRequest(t, app, pool, user, "/api/v1/submissions/"+sub.ID+"/attachments", map[string]string{"version": fmt.Sprint(sub.Version), "caption": slot}, "bild.jpg", testJPEG(t))
}

func TestSteckbriefImageSlots(t *testing.T) {
	app, pool := timelineApp(t)
	category := createSteckbriefCategory(t, app, pool, "")
	sub := decodeSubmission(t, createSteckbrief(t, app, pool, MiaID, category.ID, "steck-slots-0001", "", steckbriefBody("a", "b")))
	live := func(slot string) int {
		return countRows(t, pool, "SELECT count(*) FROM attachments WHERE submission_id=$1 AND caption=$2 AND NOT deleted", sub.ID, slot)
	}
	for _, slot := range []string{"profil", "", "Foto", "foto ", "kinderfoto,foto"} {
		if res := steckbriefUpload(t, app, pool, MiaID, sub, slot); res.Code != 400 {
			t.Fatalf("slot %q: %d %s", slot, res.Code, res.Body)
		}
	}
	if n := countRows(t, pool, "SELECT count(*) FROM attachments WHERE submission_id=$1", sub.ID); n != 0 {
		t.Fatalf("rejected slots persisted %d attachments", n)
	}
	if files := storedKeys(t, app.Config); len(files) != 0 {
		t.Fatalf("rejected slots wrote files: %v", files)
	}
	if res := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, "/api/v1/submissions/"+sub.ID, ""); res.Code != 404 {
		t.Fatalf("other student read: %d", res.Code)
	}
	if res := steckbriefUpload(t, app, pool, LeonID, sub, "foto"); res.Code != 404 {
		t.Fatalf("other student upload: %d %s", res.Code, res.Body)
	}

	sub = decodeSubmission(t, steckbriefUpload(t, app, pool, MiaID, sub, "foto"))
	sub = decodeSubmission(t, steckbriefUpload(t, app, pool, MiaID, sub, "kinderfoto"))
	if sub.Version != 3 || len(sub.Attachments) != 2 {
		t.Fatalf("two slots: %+v", sub)
	}
	kinderfoto := sub.Attachments[1]
	oldFoto := sub.Attachments[0]
	if oldFoto.Caption != "foto" || kinderfoto.Caption != "kinderfoto" {
		t.Fatalf("slot captions: %+v", sub.Attachments)
	}
	// Replacing an occupied slot keeps exactly one live image there, leaves the other slot alone and bumps the version once.
	sub = decodeSubmission(t, steckbriefUpload(t, app, pool, MiaID, sub, "foto"))
	if sub.Version != 4 || len(sub.Attachments) != 2 || live("foto") != 1 || live("kinderfoto") != 1 {
		t.Fatalf("replace: %+v live foto=%d kinderfoto=%d", sub, live("foto"), live("kinderfoto"))
	}
	byCaption := map[string]Attachment{}
	for _, att := range sub.Attachments {
		byCaption[att.Caption] = att
	}
	if byCaption["foto"].ID == oldFoto.ID || byCaption["kinderfoto"].ID != kinderfoto.ID {
		t.Fatalf("wrong slot replaced: %+v", sub.Attachments)
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, byCaption["foto"].URL, ""); res.Code != 200 {
		t.Fatalf("new image unreadable: %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, oldFoto.URL, ""); res.Code == 200 {
		t.Fatal("replaced image is still served")
	}
	if res := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, byCaption["foto"].URL, ""); res.Code != 404 {
		t.Fatalf("other student image read: %d", res.Code)
	}
	// A stale version cannot replace an image.
	if res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions/"+sub.ID+"/attachments", map[string]string{"version": "3", "caption": "foto"}, "x.jpg", testJPEG(t)); res.Code != 409 || live("foto") != 1 {
		t.Fatalf("stale replace: %d %s", res.Code, res.Body)
	}

	// Slots are not editable.
	path := "/api/v1/submissions/" + sub.ID + "/attachments/" + byCaption["foto"].ID
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, path, fmt.Sprintf(`{"version":%d,"caption":"kinderfoto"}`, sub.Version)); res.Code != 400 {
		t.Fatalf("caption edit: %d %s", res.Code, res.Body)
	}
	if n := countRows(t, pool, "SELECT count(*) FROM attachments WHERE id=$1 AND caption='foto' AND NOT deleted", byCaption["foto"].ID); n != 1 {
		t.Fatal("rejected caption edit changed the slot")
	}

	// The export carries live images only.
	res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+category.ID+"/export", "")
	zr, err := zip.NewReader(bytes.NewReader(res.Body.Bytes()), int64(res.Body.Len()))
	if res.Code != 200 || err != nil {
		t.Fatalf("export: %d err=%v", res.Code, err)
	}
	originals, csvRows := 0, ""
	for _, entry := range zr.File {
		f, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(f)
		_ = f.Close()
		if strings.HasPrefix(entry.Name, "originals/") {
			originals++
			if strings.Contains(entry.Name, oldFoto.ID) {
				t.Fatal("export contains the replaced image")
			}
		}
		if entry.Name == "submissions.csv" {
			csvRows = string(data)
		}
	}
	if originals != 2 || !strings.Contains(csvRows, "Steckbrief") {
		t.Fatalf("export: originals=%d csv=%s", originals, csvRows)
	}

	// Deleting empties a slot, including the last image.
	sub = decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodDelete, "/api/v1/submissions/"+sub.ID+"/attachments/"+kinderfoto.ID, fmt.Sprintf(`{"version":%d}`, sub.Version)))
	if len(sub.Attachments) != 1 || sub.Attachments[0].Caption != "foto" || live("kinderfoto") != 0 {
		t.Fatalf("empty kinderfoto slot: %+v", sub)
	}
	sub = decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodDelete, path, fmt.Sprintf(`{"version":%d}`, sub.Version)))
	if len(sub.Attachments) != 0 || live("foto") != 0 {
		t.Fatalf("empty foto slot: %+v", sub)
	}
	sub = decodeSubmission(t, steckbriefUpload(t, app, pool, MiaID, sub, "kinderfoto"))
	if len(sub.Attachments) != 1 || sub.Attachments[0].Caption != "kinderfoto" {
		t.Fatalf("refill slot: %+v", sub)
	}
}

func TestSteckbriefStaffAccessAndOtherKindsStillRejectUploads(t *testing.T) {
	app, pool := timelineApp(t)
	category := createSteckbriefCategory(t, app, pool, "")
	sub := decodeSubmission(t, createSteckbrief(t, app, pool, MiaID, category.ID, "steck-staff-0001", "", steckbriefBody("a", "b")))
	// Students read only their own; the list endpoint shows nothing foreign to them.
	list := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, "/api/v1/submissions?category_id="+category.ID, "")
	if list.Code != 200 || strings.TrimSpace(list.Body.String()) != "[]" {
		t.Fatalf("other student list: %d %s", list.Code, list.Body)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/submissions/"+sub.ID, ""); res.Code != 200 {
		t.Fatalf("admin read: %d", res.Code)
	}
	for i, id := range []string{categoryID(1), categoryID(2), categoryID(3)} {
		other := decodeSubmission(t, createContribution(t, app, pool, MiaID, id, fmt.Sprintf("slot-upload-other-%04d", i), "Beitrag"))
		for _, slot := range []string{"foto", ""} {
			if res := steckbriefUpload(t, app, pool, MiaID, other, slot); res.Code != 400 {
				t.Fatalf("upload with caption %q to category %s: %d %s", slot, id, res.Code, res.Body)
			}
		}
		if n := countRows(t, pool, "SELECT count(*) FROM attachments WHERE submission_id=$1", other.ID); n != 0 {
			t.Fatalf("rejected upload persisted an attachment for category %s", id)
		}
	}
}

func TestMigration016AddsSteckbriefKindWithoutChangingExistingData(t *testing.T) {
	pool, _ := migrateTo(t, "015_erased_write_guard.sql")
	ctx := context.Background()
	const (
		author = "50000000-0000-4000-8000-000000000003"
		idea   = "10000000-0000-4000-8000-000000000001"
		sub    = "20000000-0000-4000-8000-000000000001"
	)
	for _, query := range []string{
		"INSERT INTO users(id,subject,name,role,admitted,cohort_member,category_ids) VALUES ('" + author + "','author','Author','student',true,true,'{}')",
		"INSERT INTO categories(id,name,description,kind,status) VALUES ('" + idea + "','Ideen','','idea','open')",
		"INSERT INTO submissions(id,category_id,author_id,title,body,context,status,version,idempotency_key,request_hash) VALUES ('" + sub + "','" + idea + "','" + author + "','Original','Text','Kontext','accepted',2,'seed-00000001','saved-hash')",
	} {
		if _, err := pool.Exec(ctx, query); err != nil {
			t.Fatalf("prepare pre-016 records: %v", err)
		}
	}
	snapshot := func(query string) string {
		t.Helper()
		var data string
		if err := pool.QueryRow(ctx, query).Scan(&data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	queries := []string{
		`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text FROM (SELECT id,name,description,kind,repeatable,ongoing,status,version FROM categories) r`,
		`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb)::text FROM submissions r`,
	}
	before := []string{snapshot(queries[0]), snapshot(queries[1])}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for i, query := range queries {
		if snapshot(query) != before[i] {
			t.Fatalf("migration 016 changed existing rows (query %d)", i)
		}
	}
	if got := snapshot("SELECT template FROM categories WHERE id='" + idea + "'"); got != "" {
		t.Fatalf("existing category template %q", got)
	}
	// The database refuses inconsistent Steckbrief definitions even for direct SQL.
	for name, query := range map[string]string{
		"steckbrief without template": "INSERT INTO categories(id,name,description,kind) VALUES('10000000-0000-4000-8000-000000000011','S','','steckbrief')",
		"repeatable steckbrief":       "INSERT INTO categories(id,name,description,kind,template,repeatable) VALUES('10000000-0000-4000-8000-000000000012','S','','steckbrief','standard',true)",
		"template on idea":            "INSERT INTO categories(id,name,description,kind,template) VALUES('10000000-0000-4000-8000-000000000013','S','','idea','standard')",
	} {
		if _, err := pool.Exec(ctx, query); err == nil {
			t.Fatalf("%s accepted by the database", name)
		}
	}
	if _, err := pool.Exec(ctx, "INSERT INTO categories(id,name,description,kind,template) VALUES('10000000-0000-4000-8000-000000000014','S','','steckbrief','standard')"); err != nil {
		t.Fatalf("valid steckbrief rejected: %v", err)
	}
	if got := snapshot("SELECT repeatable::text FROM categories WHERE id='10000000-0000-4000-8000-000000000014'"); got != "false" {
		t.Fatalf("direct SQL steckbrief defaulted repeatable=%s", got)
	}
}
