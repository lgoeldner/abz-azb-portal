package portal

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testJPEG(t *testing.T) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := jpeg.Encode(&data, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func photoRequest(t *testing.T, app *App, pool *pgxpool.Pool, user, path string, fields map[string]string, name string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for field, value := range fields {
		if err := form.WriteField(field, value); err != nil {
			t.Fatal(err)
		}
	}
	if name != "" {
		part, err := form.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	token, csrf := randomToken(), randomToken()
	if _, err := pool.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(token), user, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("X-CSRF-Token", csrf)
	req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	return res
}

func TestPhotoCreateAtomicValidationAndReplay(t *testing.T) {
	app, pool := timelineApp(t)
	category := createPhotoCategory(t, app, pool, boolPtr(false))
	fields := map[string]string{"category_id": category.ID, "idempotency_key": "atomic-photo-0001", "caption": "Unser erster Tag"}
	data := testJPEG(t)
	for _, test := range []struct {
		name string
		data []byte
	}{{"spoof.jpg", []byte("<svg>fake</svg>")}, {"broken.jpg", data[:len(data)/2]}, {"", nil}} {
		res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, test.name, test.data)
		if res.Code != 400 {
			t.Fatalf("invalid image %s: %d %s", test.name, res.Code, res.Body)
		}
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", fmt.Sprintf(`{"category_id":%q,"idempotency_key":"text-photo-0001","title":"Text only","body":"","context":""}`, category.ID)); res.Code != 400 {
		t.Fatalf("photo JSON create: %d %s", res.Code, res.Body)
	}
	fields["body"] = "Prose"
	if res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data); res.Code != 400 {
		t.Fatalf("photo prose: %d %s", res.Code, res.Body)
	}
	delete(fields, "body")
	fields["caption"] = strings.Repeat("ä", 2001)
	if res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data); res.Code != 400 {
		t.Fatalf("overlong caption: %d %s", res.Code, res.Body)
	}
	fields["caption"] = "Unser erster Tag"
	// File persistence must succeed before the transaction can expose a submission.
	originalDir := app.Config.UploadDir
	app.Config.UploadDir = originalDir + "/missing"
	if res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data); res.Code != 500 {
		t.Fatalf("failed persistence: %d %s", res.Code, res.Body)
	}
	app.Config.UploadDir = originalDir
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM submissions WHERE category_id=$1", category.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid upload left submission count %d: %v", count, err)
	}
	entries, err := os.ReadDir(app.Config.UploadDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("invalid upload left files: %d %v", len(entries), err)
	}
	created := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data)
	if created.Code != 201 {
		t.Fatalf("create photo: %d %s", created.Code, created.Body)
	}
	sub := decodeSubmission(t, created)
	if sub.Title != "pic.jpg" || sub.Body != "" || sub.Version != 1 || len(sub.Attachments) != 1 || sub.Attachments[0].Caption != fields["caption"] {
		t.Fatalf("photo fields: %+v", sub)
	}
	retry := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data)
	if retry.Code != 200 || decodeSubmission(t, retry).ID != sub.ID {
		t.Fatalf("multipart retry: %d %s", retry.Code, retry.Body)
	}
	fields["caption"] = "Changed"
	if res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", fields, "pic.jpg", data); res.Code != 409 {
		t.Fatalf("changed caption retry: %d %s", res.Code, res.Body)
	}
	entries, err = os.ReadDir(app.Config.UploadDir)
	if err != nil || len(entries) != 2 {
		t.Fatalf("retry wrote extra files: %d %v", len(entries), err)
	}
	// The existing JSON route remains available for nonphoto contributions.
	if res := createContribution(t, app, pool, MiaID, categoryID(1), "ordinary-text-0001", "Idea"); res.Code != 201 {
		t.Fatalf("nonphoto JSON: %d %s", res.Code, res.Body)
	}
}

func TestPhotoCaptionOwnershipHistoryExportAndLastImage(t *testing.T) {
	app, pool := timelineApp(t)
	category := createPhotoCategory(t, app, pool, nil)
	sub := decodeSubmission(t, photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{"category_id": category.ID, "idempotency_key": "caption-photo-0001", "caption": "Original"}, "pic.jpg", testJPEG(t)))
	path := "/api/v1/submissions/" + sub.ID + "/attachments/" + sub.Attachments[0].ID
	for _, user := range []string{LeonID, ManagerID, AdminID} {
		expected := 403
		if user == LeonID {
			expected = 404
		}
		res := authenticatedRequest(t, app, pool, user, http.MethodPatch, path, `{"version":1,"caption":"Unauthorized"}`)
		if res.Code != expected {
			t.Fatalf("caption permissions for %s: %d %s", user, res.Code, res.Body)
		}
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, path, `{"version":2,"caption":"Stale"}`); res.Code != 409 {
		t.Fatalf("stale caption: %d %s", res.Code, res.Body)
	}
	sub = decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, path, `{"version":1,"caption":"Korrigiert"}`))
	if sub.Version != 2 || sub.Attachments[0].Caption != "Korrigiert" {
		t.Fatalf("caption edit: %+v", sub)
	}
	res := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, "/api/v1/submissions/"+sub.ID+"/revisions", "")
	var revisions []Revision
	if err := json.Unmarshal(res.Body.Bytes(), &revisions); err != nil || len(revisions) != 2 || len(revisions[0].Attachments) != 1 || revisions[0].Attachments[0].Caption != "Korrigiert" || revisions[1].Attachments[0].Caption != "Original" {
		t.Fatalf("caption history: %s err=%v", res.Body, err)
	}
	res = authenticatedRequest(t, app, pool, ManagerID, http.MethodGet, "/api/v1/categories/"+category.ID+"/export", "")
	if res.Code != 200 {
		t.Fatalf("export: %d %s", res.Code, res.Body)
	}
	zr, err := zip.NewReader(bytes.NewReader(res.Body.Bytes()), int64(res.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range zr.File {
		if entry.Name == "manifest.json" {
			f, err := entry.Open()
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil {
				t.Fatal(err)
			}
			if strings.Count(string(data), `"caption":"Korrigiert"`) != 2 {
				t.Fatalf("export omitted captions: %s", data)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("missing export manifest")
	}
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodDelete, path, `{"version":2}`); res.Code != 400 {
		t.Fatalf("deleted final photo: %d %s", res.Code, res.Body)
	}
	sub = decodeSubmission(t, photoRequest(t, app, pool, MiaID, "/api/v1/submissions/"+sub.ID+"/attachments", map[string]string{"version": "2", "caption": "Second"}, "second.jpg", testJPEG(t)))
	if len(sub.Attachments) != 2 || sub.Attachments[1].Caption != "Second" {
		t.Fatalf("upload caption: %+v", sub)
	}
	sub = decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodDelete, path, `{"version":3}`))
	if len(sub.Attachments) != 1 {
		t.Fatalf("remove one photo: %+v", sub)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/submissions/"+sub.ID+"/status", `{"version":4,"status":"accepted"}`); res.Code != 200 {
		t.Fatalf("accept: %d %s", res.Code, res.Body)
	}
	path = "/api/v1/submissions/" + sub.ID + "/attachments/" + sub.Attachments[0].ID
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, path, `{"version":5,"caption":"Locked"}`); res.Code != 403 {
		t.Fatalf("locked caption edit: %d %s", res.Code, res.Body)
	}
}

func TestPhotoMovesAndLegacyEmptySubmission(t *testing.T) {
	app, pool := timelineApp(t)
	category := createPhotoCategory(t, app, pool, nil)
	textOnly := decodeSubmission(t, createContribution(t, app, pool, MiaID, categoryID(1), "text-move-plain-0001", "Idea"))
	move := fmt.Sprintf(`{"version":%d,"category_id":%q,"title":"Photo","body":"","context":""}`, textOnly.Version, category.ID)
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+textOnly.ID, move); res.Code != 400 {
		t.Fatalf("text-only move to photo: %d %s", res.Code, res.Body)
	}

	photoTarget := createPhotoCategory(t, app, pool, nil)
	sub := decodeSubmission(t, photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{"category_id": category.ID, "idempotency_key": "photo-move-image-0001"}, "pic.jpg", testJPEG(t)))
	move = fmt.Sprintf(`{"version":%d,"category_id":%q,"title":"Photo","body":"","context":""}`, sub.Version, photoTarget.ID)
	sub = decodeSubmission(t, authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, move))
	if sub.CategoryID != photoTarget.ID || sub.Version != 2 {
		t.Fatalf("photo-to-photo move: %+v", sub)
	}
	move = fmt.Sprintf(`{"version":%d,"category_id":%q,"title":"Photo","body":"","context":""}`, sub.Version, categoryID(1))
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, move); res.Code != 400 {
		t.Fatalf("photo with active image moved to nonphoto category: %d %s", res.Code, res.Body)
	}
	edit := fmt.Sprintf(`{"version":%d,"category_id":%q,"title":"Photo","body":"Text","context":""}`, sub.Version, photoTarget.ID)
	if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, edit); res.Code != 400 {
		t.Fatalf("photo edited into prose: %d %s", res.Code, res.Body)
	}

	// Legacy nonphoto attachments remain readable, editable and removable, while
	// a same-category text edit is still allowed and new uploads are rejected.
	legacyPhoto := decodeSubmission(t, photoRequest(t, app, pool, LeonID, "/api/v1/submissions", map[string]string{"category_id": category.ID, "idempotency_key": "legacy-photo-file-0001"}, "legacy.jpg", testJPEG(t)))
	if _, err := pool.Exec(context.Background(), "UPDATE submissions SET category_id=$2 WHERE id=$1", legacyPhoto.ID, categoryID(1)); err != nil {
		t.Fatal(err)
	}
	edit = fmt.Sprintf(`{"version":%d,"category_id":%q,"title":"Legacy text","body":"Kept prose","context":""}`, legacyPhoto.Version, categoryID(1))
	legacyPhoto = decodeSubmission(t, authenticatedRequest(t, app, pool, LeonID, http.MethodPatch, "/api/v1/submissions/"+legacyPhoto.ID, edit))
	captionPath := "/api/v1/submissions/" + legacyPhoto.ID + "/attachments/" + legacyPhoto.Attachments[0].ID
	legacyPhoto = decodeSubmission(t, authenticatedRequest(t, app, pool, LeonID, http.MethodPatch, captionPath, fmt.Sprintf(`{"version":%d,"caption":"Altes Bild"}`, legacyPhoto.Version)))
	if legacyPhoto.Attachments[0].Caption != "Altes Bild" {
		t.Fatalf("legacy caption edit: %+v", legacyPhoto.Attachments[0])
	}
	if res := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, legacyPhoto.Attachments[0].URL, ""); res.Code != 200 {
		t.Fatalf("legacy original read: %d %s", res.Code, res.Body)
	}
	if res := authenticatedFileUpload(t, app, pool, LeonID, "/api/v1/submissions/"+legacyPhoto.ID+"/attachments", legacyPhoto.Version, "new.jpg", testJPEG(t)); res.Code != 400 {
		t.Fatalf("legacy nonphoto upload: %d %s", res.Code, res.Body)
	}
	var attachmentCount, revisionCount, version int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM attachments WHERE submission_id=$1 AND NOT deleted", legacyPhoto.ID).Scan(&attachmentCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM revisions WHERE submission_id=$1", legacyPhoto.ID).Scan(&revisionCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT version FROM submissions WHERE id=$1", legacyPhoto.ID).Scan(&version); err != nil || attachmentCount != 1 || revisionCount != 3 || version != legacyPhoto.Version {
		t.Fatalf("rejected legacy upload changed rows: attachments=%d revisions=%d version=%d want version=%d err=%v", attachmentCount, revisionCount, version, legacyPhoto.Version, err)
	}
	files, err := os.ReadDir(app.Config.UploadDir)
	if err != nil || len(files) != 4 {
		t.Fatalf("rejected legacy upload wrote files: count=%d err=%v", len(files), err)
	}
	legacyPhoto = decodeSubmission(t, authenticatedRequest(t, app, pool, LeonID, http.MethodDelete, captionPath, fmt.Sprintf(`{"version":%d}`, legacyPhoto.Version)))
	if len(legacyPhoto.Attachments) != 0 {
		t.Fatalf("legacy attachment removal: %+v", legacyPhoto.Attachments)
	}

	// Legacy image-less photo records remain readable and can receive their first image.
	legacy := "20000000-0000-4000-8000-000000000004"
	if res := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, "/api/v1/submissions/"+legacy, ""); res.Code != 200 {
		t.Fatalf("legacy photo read: %d %s", res.Code, res.Body)
	}
	uploaded := decodeSubmission(t, authenticatedFileUpload(t, app, pool, LeonID, "/api/v1/submissions/"+legacy+"/attachments", 1, "legacy.jpg", testJPEG(t)))
	if len(uploaded.Attachments) != 1 || uploaded.Attachments[0].Caption != "" {
		t.Fatalf("legacy upload: %+v", uploaded)
	}
}

func TestAttachmentsOnlyUploadToPhotoCollections(t *testing.T) {
	app, pool := timelineApp(t)
	for i, collectionID := range []string{categoryID(1), categoryID(2), categoryID(3)} {
		nonphoto := decodeSubmission(t, createContribution(t, app, pool, MiaID, collectionID, fmt.Sprintf("no-photo-upload-%04d", i), "Idea"))
		if res := authenticatedFileUpload(t, app, pool, MiaID, "/api/v1/submissions/"+nonphoto.ID+"/attachments", nonphoto.Version, "rejected.jpg", testJPEG(t)); res.Code != 400 {
			t.Fatalf("nonphoto attachment upload for category %s: %d %s", collectionID, res.Code, res.Body)
		}
		var attachments, revisions, auditEvents, version int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM attachments WHERE submission_id=$1", nonphoto.ID).Scan(&attachments); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM revisions WHERE submission_id=$1", nonphoto.ID).Scan(&revisions); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE entity_id=$1", nonphoto.ID).Scan(&auditEvents); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(context.Background(), "SELECT version FROM submissions WHERE id=$1", nonphoto.ID).Scan(&version); err != nil || attachments != 0 || revisions != 1 || auditEvents != 1 || version != nonphoto.Version {
			t.Fatalf("rejected upload changed database state for category %s: attachments=%d revisions=%d audit=%d version=%d err=%v", collectionID, attachments, revisions, auditEvents, version, err)
		}
		files, err := os.ReadDir(app.Config.UploadDir)
		if err != nil || len(files) != 0 {
			t.Fatalf("rejected upload wrote files for category %s: count=%d err=%v", collectionID, len(files), err)
		}
	}

	photoCategory := createPhotoCategory(t, app, pool, nil)
	photo := decodeSubmission(t, photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{"category_id": photoCategory.ID, "idempotency_key": "allowed-photo-upload-0001"}, "first.jpg", testJPEG(t)))
	added := authenticatedFileUpload(t, app, pool, MiaID, "/api/v1/submissions/"+photo.ID+"/attachments", photo.Version, "second.jpg", testJPEG(t))
	if added.Code != 200 || len(decodeSubmission(t, added).Attachments) != 2 {
		t.Fatalf("photo attachment upload: %d %s", added.Code, added.Body)
	}
}

func TestPopulatedPhotoCollectionCannotChangeToNonphoto(t *testing.T) {
	app, pool := timelineApp(t)
	category := createPhotoCategory(t, app, pool, nil)
	if created := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{"category_id": category.ID, "idempotency_key": "kind-change-photo-0001"}, "pic.jpg", testJPEG(t)); created.Code != 201 {
		t.Fatalf("create photo contribution: %d %s", created.Code, created.Body)
	}
	change := fmt.Sprintf(`{"name":"Changed","description":"","kind":"idea","version":%d,"options":[]}`, category.Version)
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+category.ID, change); res.Code != 400 {
		t.Fatalf("populated photo category changed kind: %d %s", res.Code, res.Body)
	}
	var kind string
	var version int
	if err := pool.QueryRow(context.Background(), "SELECT kind,version FROM categories WHERE id=$1", category.ID).Scan(&kind, &version); err != nil || kind != "photo" || version != category.Version {
		t.Fatalf("rejected kind change persisted: kind=%s version=%d err=%v", kind, version, err)
	}
}

func TestMigration009PreservesLegacyPhotosAndHistory(t *testing.T) {
	pool, _ := migrateTo(t, "008_collection_repeatability.sql")
	ctx := context.Background()
	user, category, submission, attachment := ID(), ID(), ID(), ID()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{"INSERT INTO users(id,subject,name) VALUES($1,'legacy','Legacy author')", []any{user}},
		{"INSERT INTO categories(id,name,kind) VALUES($1,'Photos','photo')", []any{category}},
		{"INSERT INTO submissions(id,category_id,author_id,title,body,idempotency_key,request_hash) VALUES($1,$2,$3,'Legacy title','Preserved prose','legacy-key','original-hash')", []any{submission, category, user}},
		{"INSERT INTO attachments(id,submission_id,filename,mime_type,size_bytes,sha256,storage_key,preview_key) VALUES($1,$2,'legacy.jpg','image/jpeg',10,'checksum','original-key','preview-key')", []any{attachment, submission}},
		{"INSERT INTO revisions(id,submission_id,version,actor_id,title,body,context,status) VALUES($1,$2,1,$3,'Legacy title','Preserved prose','','pending')", []any{ID(), submission, user}},
	} {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	queries := map[string]string{
		"submissions": "SELECT jsonb_agg(to_jsonb(s))::text FROM submissions s",
		"attachments": "SELECT jsonb_agg(to_jsonb(a)-'caption')::text FROM attachments a",
		"revisions":   "SELECT jsonb_agg(to_jsonb(r)-'attachments')::text FROM revisions r",
	}
	before := map[string]string{}
	for name, query := range queries {
		var value string
		if err := pool.QueryRow(ctx, query).Scan(&value); err != nil {
			t.Fatal(err)
		}
		before[name] = value
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for name, query := range queries {
		var value string
		if err := pool.QueryRow(ctx, query).Scan(&value); err != nil {
			t.Fatal(err)
		}
		if value != before[name] {
			t.Fatalf("migration rewrote legacy %s", name)
		}
	}
	var caption, history string
	if err := pool.QueryRow(ctx, "SELECT a.caption,r.attachments::text FROM attachments a JOIN revisions r USING(submission_id)").Scan(&caption, &history); err != nil || caption != "" || history != "[]" {
		t.Fatalf("legacy caption defaults: caption=%q history=%q err=%v", caption, history, err)
	}
}
