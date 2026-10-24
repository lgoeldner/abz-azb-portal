package portal

import (
	"abizeitbetrug/auth-mock/authmock"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
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

func TestPureInvariants(t *testing.T) {
	if !validID("00000000-0000-4000-8000-000000000001") || validID("x0000000-0000-4000-8000-000000000001") {
		t.Fatal("UUID validation accepted an invalid id")
	}
	if got := safeFilename("../../private\\x\n.jpg"); got != "x.jpg" {
		t.Fatalf("unsafe filename was not reduced: %q", got)
	}
	if got := csvCell("=HYPERLINK(\"x\")"); got != "'=HYPERLINK(\"x\")" {
		t.Fatalf("formula cell was not escaped: %q", got)
	}
	student := User{ID: MiaID, Role: "student"}
	for _, tc := range []struct {
		previous, next string
		ok             bool
	}{
		{"pending", "withdrawn", true}, {"pending", "accepted", false}, {"accepted", "withdrawn", false},
	} {
		got := allowedTransition(student, Submission{AuthorID: MiaID, Status: tc.previous}, tc.next)
		if got != tc.ok {
			t.Errorf("transition %s -> %s = %v, want %v", tc.previous, tc.next, got, tc.ok)
		}
	}
	var imageData bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.White)
	if err := jpeg.Encode(&imageData, img, nil); err != nil {
		t.Fatal(err)
	}
	if _, mimeType, err := imagePreview(imageData.Bytes()); err != nil || mimeType != "image/jpeg" {
		t.Fatalf("valid jpeg preview failed: mime=%q err=%v", mimeType, err)
	}
	if _, _, err := imagePreview([]byte("not an image")); err == nil {
		t.Fatal("invalid image was accepted")
	}
}

func FuzzValidID(f *testing.F) {
	f.Add("00000000-0000-4000-8000-000000000001")
	f.Add("not-a-uuid")
	f.Fuzz(func(t *testing.T, value string) {
		if validID(value) && len(value) != 36 {
			t.Fatalf("validID accepted length %d", len(value))
		}
	})
}

func TestProductionRejectsMockAuth(t *testing.T) {
	c := Config{Env: "production", DatabaseURL: "postgres://localhost/test", PublicURL: "https://portal.example", AuthMode: "mock", UploadDir: t.TempDir(), StaticDir: t.TempDir()}
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "mock authentication forbidden") {
		t.Fatalf("production accepted mock auth: %v", err)
	}
}

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := emptySchemaPool(t)
	if err := Migrate(context.Background(), pool); err != nil {
		t.Fatalf("migrate test schema: %v", err)
	}
	return pool
}

// emptySchemaPool returns a pool on a fresh isolated schema with no tables.
func emptySchemaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipped PostgreSQL invariant test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("invalid TEST_DATABASE_URL: %v", err)
	}
	admin, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		t.Fatalf("TEST_DATABASE_URL unavailable: %v", err)
	}
	schema := fmt.Sprintf("portal_test_%x", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatalf("create isolated schema: %v", err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}

func authenticatedRequest(t *testing.T, app *App, pool *pgxpool.Pool, userID, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	token, csrf := randomToken(), randomToken()
	if _, err := pool.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(token), userID, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	if method != http.MethodGet {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	return res
}

func TestPostgresAuthorizationLifecycleAndBallots(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	provider := mockProvider(t, "", "http://localhost:8080", []authmock.User{{Subject: FixtureSubject(MiaID), Name: "Mia", DisplaySlug: "mia_weber"}})
	if err := SeedWithIssuer(ctx, pool, "development", provider.URL); err != nil {
		t.Fatal(err)
	}
	c := Config{Env: "development", DatabaseURL: "postgres://unused", PublicURL: "http://localhost:8080", UploadDir: t.TempDir(), StaticDir: t.TempDir(), AuthMode: "mock", Issuer: provider.URL, ClientID: "portal-dev", ClientSecret: "dev-only", SessionSecret: strings.Repeat("s", 32)}
	app, err := New(ctx, c, pool)
	if err != nil {
		t.Fatal(err)
	}
	cat := categoryID(1)
	pendingMe := authenticatedRequest(t, app, pool, PendingID, http.MethodGet, "/api/v1/me", "")
	pendingAPI := authenticatedRequest(t, app, pool, PendingID, http.MethodGet, "/api/v1/categories", "")
	if pendingMe.Code != http.StatusOK || pendingAPI.Code != http.StatusForbidden {
		t.Fatalf("pending account access: /me=%d protected API=%d", pendingMe.Code, pendingAPI.Code)
	}

	// Private reads and author edits are enforced by HTTP middleware and handlers.
	created := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", fmt.Sprintf(`{"idempotency_key":"retry-key-0001","category_id":%q,"title":"Private","body":"body","context":""}`, cat))
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", created.Code, created.Body)
	}
	var sub Submission
	if err := json.Unmarshal(created.Body.Bytes(), &sub); err != nil {
		t.Fatal(err)
	}
	if got := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, "/api/v1/submissions/"+sub.ID, ""); got.Code != http.StatusNotFound {
		t.Fatalf("other student read status=%d", got.Code)
	}
	retry := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", fmt.Sprintf(`{"idempotency_key":"retry-key-0001","category_id":%q,"title":"Private","body":"body","context":""}`, cat))
	if retry.Code != http.StatusOK {
		t.Fatalf("idempotent retry status=%d", retry.Code)
	}
	changedRetry := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions", fmt.Sprintf(`{"idempotency_key":"retry-key-0001","category_id":%q,"title":"Different","body":"body","context":""}`, cat))
	if changedRetry.Code != http.StatusConflict {
		t.Fatalf("changed retry status=%d", changedRetry.Code)
	}

	// Manager grants are checked against the live user record for each write.
	managerWrite := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, fmt.Sprintf(`{"version":1,"category_id":%q,"title":"Edited","body":"body","context":""}`, cat))
	if managerWrite.Code != http.StatusOK {
		t.Fatalf("assigned manager write status=%d: %s", managerWrite.Code, managerWrite.Body)
	}
	stale := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, fmt.Sprintf(`{"version":1,"category_id":%q,"title":"Stale","body":"body","context":""}`, cat))
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale version status=%d", stale.Code)
	}
	if _, err := pool.Exec(ctx, "UPDATE users SET category_ids='{}' WHERE id=$1", ManagerID); err != nil {
		t.Fatal(err)
	}
	revoked := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, fmt.Sprintf(`{"version":2,"category_id":%q,"title":"Denied","body":"body","context":""}`, cat))
	if revoked.Code != http.StatusForbidden {
		t.Fatalf("revoked grant write status=%d", revoked.Code)
	}

	// Closed contributions remain visible to their author; correction requests work.
	accept := authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/submissions/"+sub.ID+"/status", `{"version":2,"status":"accepted"}`)
	if accept.Code != http.StatusForbidden {
		t.Fatalf("revoked manager transitioned status=%d", accept.Code)
	}
	accept = authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/submissions/"+sub.ID+"/status", `{"version":2,"status":"accepted"}`)
	if accept.Code != http.StatusOK {
		t.Fatalf("admin accepted status=%d: %s", accept.Code, accept.Body)
	}
	corr := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions/"+sub.ID+"/corrections", `{"body":"Please fix this"}`)
	if corr.Code != http.StatusCreated {
		t.Fatalf("author correction status=%d", corr.Code)
	}
	backToPending := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/submissions/"+sub.ID+"/status", `{"version":3,"status":"pending"}`)
	if backToPending.Code != http.StatusOK {
		t.Fatalf("editor re-open status=%d", backToPending.Code)
	}
	authorEdit := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+sub.ID, fmt.Sprintf(`{"version":4,"category_id":%q,"title":"Author revision","body":"body","context":""}`, cat))
	if authorEdit.Code != http.StatusOK {
		t.Fatalf("pending author revision status=%d: %s", authorEdit.Code, authorEdit.Body)
	}
	revisions := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, "/api/v1/submissions/"+sub.ID+"/revisions", "")
	if revisions.Code != http.StatusOK || !strings.Contains(revisions.Body.String(), "Author revision") {
		t.Fatalf("revision history status=%d body=%s", revisions.Code, revisions.Body)
	}

	// Private originals and previews are bound to the submission's read permission.
	photo, photoErr := pool.Exec(ctx, "INSERT INTO submissions(id,category_id,author_id,title,body,context,idempotency_key,request_hash) VALUES($1,$2,$3,'Photo','', '', 'photo-key-0001','photo')", "50000000-0000-4000-8000-000000000001", categoryID(1), MiaID)
	if photoErr != nil || photo.RowsAffected() != 1 {
		t.Fatalf("create photo contribution: %v", photoErr)
	}
	photoID := "50000000-0000-4000-8000-000000000001"
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatal(err)
	}
	var multipartBody bytes.Buffer
	form := multipart.NewWriter(&multipartBody)
	_ = form.WriteField("version", "1")
	part, err := form.CreateFormFile("file", "pic.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(part, bytes.NewReader(jpegData.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	token, csrf := randomToken(), randomToken()
	if _, err := pool.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(token), MiaID, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/submissions/"+photoID+"/attachments", &multipartBody)
	uploadReq.Header.Set("Content-Type", form.FormDataContentType())
	uploadReq.Header.Set("X-CSRF-Token", csrf)
	uploadReq.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	uploadRes := httptest.NewRecorder()
	app.ServeHTTP(uploadRes, uploadReq)
	if uploadRes.Code != http.StatusOK {
		t.Fatalf("upload status=%d: %s", uploadRes.Code, uploadRes.Body)
	}
	var photoSubmission Submission
	if err := json.Unmarshal(uploadRes.Body.Bytes(), &photoSubmission); err != nil {
		t.Fatal(err)
	}
	attachmentURL := photoSubmission.Attachments[0].URL
	otherRead := authenticatedRequest(t, app, pool, LeonID, http.MethodGet, attachmentURL, "")
	ownerRead := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, attachmentURL, "")
	if otherRead.Code != http.StatusNotFound || ownerRead.Code != http.StatusOK {
		t.Fatalf("private attachment statuses: other=%d owner=%d", otherRead.Code, ownerRead.Code)
	}
	var storedChecksum string
	if err := pool.QueryRow(ctx, "SELECT sha256 FROM attachments WHERE id=$1", photoSubmission.Attachments[0].ID).Scan(&storedChecksum); err != nil || storedChecksum != digest(jpegData.String()) {
		t.Fatalf("attachment checksum mismatch: checksum=%q error=%v", storedChecksum, err)
	}
	accepted := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/submissions/"+photoID+"/status", `{"version":2,"status":"accepted"}`)
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept uploaded contribution status=%d: %s", accepted.Code, accepted.Body)
	}
	var lockedBody bytes.Buffer
	lockedForm := multipart.NewWriter(&lockedBody)
	_ = lockedForm.WriteField("version", "3")
	lockedPart, err := lockedForm.CreateFormFile("file", "locked.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(lockedPart, bytes.NewReader(jpegData.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err := lockedForm.Close(); err != nil {
		t.Fatal(err)
	}
	lockedReq := httptest.NewRequest(http.MethodPost, "/api/v1/submissions/"+photoID+"/attachments", &lockedBody)
	lockedReq.Header.Set("Content-Type", lockedForm.FormDataContentType())
	lockedReq.Header.Set("X-CSRF-Token", csrf)
	lockedReq.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	lockedRes := httptest.NewRecorder()
	app.ServeHTTP(lockedRes, lockedReq)
	if lockedRes.Code != http.StatusForbidden {
		t.Fatalf("accepted author attachment upload status=%d", lockedRes.Code)
	}

	// A named ballot is visible only to an administrator; self-vote and cross-poll options fail.
	poll := "30000000-0000-4000-8000-000000000001"
	option := "40000000-0000-4000-8000-000000000101"
	proposal := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+poll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, option))
	if proposal.Code != http.StatusOK {
		t.Fatalf("vote status=%d: %s", proposal.Code, proposal.Body)
	}
	startVotes := make(chan struct{})
	concurrentVotes := make(chan *httptest.ResponseRecorder, 2)
	for _, candidate := range []string{"40000000-0000-4000-8000-000000000102", "40000000-0000-4000-8000-000000000103"} {
		candidate := candidate
		go func() {
			<-startVotes
			concurrentVotes <- authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+poll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, candidate))
		}()
	}
	close(startVotes)
	for i := 0; i < 2; i++ {
		if response := <-concurrentVotes; response.Code != http.StatusOK {
			t.Fatalf("concurrent ballot update status=%d: %s", response.Code, response.Body)
		}
	}
	var currentBallots int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballots WHERE poll_id=$1 AND user_id=$2", poll, MiaID).Scan(&currentBallots); err != nil || currentBallots != 1 {
		t.Fatalf("concurrent vote left %d current ballots (error %v)", currentBallots, err)
	}
	// Hold the row lock while a ballot request starts; after closure commits, no vote can land.
	closeTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := closeTx.Exec(ctx, "SELECT id FROM categories WHERE id=$1 FOR UPDATE", poll); err != nil {
		t.Fatal(err)
	}
	voteDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		voteDone <- authenticatedRequest(t, app, pool, LeonID, http.MethodPut, "/api/v1/categories/"+poll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, option))
	}()
	if _, err := closeTx.Exec(ctx, "UPDATE categories SET status='closed',version=version+1 WHERE id=$1", poll); err != nil {
		t.Fatal(err)
	}
	if err := closeTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	concurrentVote := <-voteDone
	if concurrentVote.Code != http.StatusConflict {
		t.Fatalf("vote racing with closure status=%d", concurrentVote.Code)
	}
	studentAudit := authenticatedRequest(t, app, pool, MiaID, http.MethodGet, "/api/v1/categories/"+poll+"/audit", "")
	if studentAudit.Code != http.StatusForbidden {
		t.Fatalf("student audit status=%d", studentAudit.Code)
	}
	closedVote := authenticatedRequest(t, app, pool, LeonID, http.MethodPut, "/api/v1/categories/"+poll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, option))
	if closedVote.Code != http.StatusConflict {
		t.Fatalf("closed poll vote status=%d", closedVote.Code)
	}
	adminAudit := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+poll+"/audit", "")
	if adminAudit.Code != http.StatusOK || !strings.Contains(adminAudit.Body.String(), MiaID) {
		t.Fatalf("admin audit status=%d body=%s", adminAudit.Code, adminAudit.Body)
	}
	selfVote := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/30000000-0000-4000-8000-000000000002/ballot", `{"option_id":"40000000-0000-4000-8000-000000000201"}`)
	if selfVote.Code != http.StatusBadRequest {
		t.Fatalf("self-vote status=%d", selfVote.Code)
	}

	// A non-person poll option cannot be reused across polls due to its composite key.
	otherPoll := "30000000-0000-4000-8000-000000000002"
	cross := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+otherPoll+"/ballot", fmt.Sprintf(`{"option_id":%q}`, option))
	if cross.Code != http.StatusBadRequest {
		t.Fatalf("cross-poll option vote status=%d", cross.Code)
	}

	// Seed subjects include the OIDC issuer namespace used by the mock provider.
	var subject string
	if err := pool.QueryRow(ctx, "SELECT subject FROM users WHERE id=$1", MiaID).Scan(&subject); err != nil {
		t.Fatal(err)
	}
	if subject != app.auth.issuer+"\x1f"+FixtureSubject(MiaID) {
		t.Fatalf("subject is not issuer-namespaced: %q", subject)
	}
}
