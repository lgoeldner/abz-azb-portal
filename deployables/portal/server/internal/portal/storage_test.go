package portal

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

const fakeStorageSecret = "private-storage-error-sentinel"

type fakeGCSObject struct {
	Data         []byte
	ContentType  string
	CacheControl string
}

type fakeGCSUpload struct {
	Name         string `json:"name"`
	ContentType  string `json:"contentType"`
	CacheControl string `json:"cacheControl"`
}

type fakeGCSRequest struct {
	Method string
	URI    string
	Query  url.Values
	Upload fakeGCSUpload
}

// fakeGCS implements only the JSON API calls used by the portal: resumable
// upload initiation/finalization, private media reads and object listing.
type fakeGCS struct {
	mu           sync.Mutex
	server       *httptest.Server
	objects      map[string]fakeGCSObject
	uploads      map[string]fakeGCSUpload
	uploadData   map[string][]byte
	requests     []fakeGCSRequest
	nextUpload   int
	failFinalize func(string) bool
	failRead     bool
	failListing  bool
}

func newFakeGCS(t *testing.T) *fakeGCS {
	t.Helper()
	fake := &fakeGCS{objects: map[string]fakeGCSObject{}, uploads: map[string]fakeGCSUpload{}, uploadData: map[string][]byte{}}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serveHTTP))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeGCS) serveHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	request := fakeGCSRequest{Method: r.Method, URI: r.RequestURI, Query: r.URL.Query()}
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/upload/storage/v1/b/") {
		uploadType := r.URL.Query().Get("uploadType")
		var media []byte
		switch uploadType {
		case "multipart":
			request.Upload, media = parseMultipartUpload(r.Header.Get("Content-Type"), body)
		case "resumable":
			_ = json.Unmarshal(body, &request.Upload)
		}
		f.requests = append(f.requests, request)
		if (uploadType != "resumable" && uploadType != "multipart") || r.URL.Query().Get("ifGenerationMatch") != "0" || request.Upload.Name == "" {
			writeFakeGCSError(w, http.StatusBadRequest)
			return
		}
		if _, exists := f.objects[request.Upload.Name]; exists {
			writeFakeGCSError(w, http.StatusPreconditionFailed)
			return
		}
		if uploadType == "multipart" {
			if f.failFinalize != nil && f.failFinalize(request.Upload.Name) {
				writeFakeGCSError(w, http.StatusForbidden)
				return
			}
			f.objects[request.Upload.Name] = fakeGCSObject{Data: append([]byte(nil), media...), ContentType: request.Upload.ContentType, CacheControl: request.Upload.CacheControl}
			writeFakeGCSObject(w, request.Upload, len(media))
			return
		}
		f.nextUpload++
		uploadID := fmt.Sprintf("upload-%d", f.nextUpload)
		f.uploads[uploadID] = request.Upload
		w.Header().Set("Location", f.server.URL+"/upload-session/"+uploadID)
		w.WriteHeader(http.StatusOK)
		return
	}
	if (r.Method == http.MethodPost || r.Method == http.MethodPut) && strings.HasPrefix(r.URL.Path, "/upload-session/") {
		uploadID := strings.TrimPrefix(r.URL.Path, "/upload-session/")
		upload, ok := f.uploads[uploadID]
		request.Upload = upload
		f.requests = append(f.requests, request)
		if !ok {
			writeFakeGCSError(w, http.StatusNotFound)
			return
		}
		data := append(f.uploadData[uploadID], body...)
		if strings.HasSuffix(r.Header.Get("Content-Range"), "/*") {
			f.uploadData[uploadID] = data
			w.Header().Set("X-Http-Status-Code-Override", "308")
			w.WriteHeader(http.StatusOK)
			return
		}
		if f.failFinalize != nil && f.failFinalize(upload.Name) {
			writeFakeGCSError(w, http.StatusForbidden)
			return
		}
		f.objects[upload.Name] = fakeGCSObject{Data: data, ContentType: upload.ContentType, CacheControl: upload.CacheControl}
		delete(f.uploadData, uploadID)
		writeFakeGCSObject(w, upload, len(data))
		return
	}
	if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/storage/v1/b/") && strings.Contains(r.URL.Path, "/o/") && r.URL.Query().Get("alt") == "media" {
		request.Upload.Name = objectNameFromPath(r.URL.Path)
		f.requests = append(f.requests, request)
		if f.failRead {
			writeFakeGCSError(w, http.StatusForbidden)
			return
		}
		object, ok := f.objects[request.Upload.Name]
		if !ok {
			writeFakeGCSError(w, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", object.ContentType)
		w.Header().Set("Cache-Control", object.CacheControl)
		_, _ = w.Write(object.Data)
		return
	}
	if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/storage/v1/b/") && strings.HasSuffix(r.URL.Path, "/o") {
		f.requests = append(f.requests, request)
		if f.failListing {
			writeFakeGCSError(w, http.StatusForbidden)
			return
		}
		type item struct {
			Name string `json:"name"`
			Size int    `json:"size,string"`
		}
		items := make([]item, 0, len(f.objects))
		for name, object := range f.objects {
			items = append(items, item{Name: name, Size: len(object.Data)})
		}
		w.Header().Set("Content-Type", "application/json; charset=UTF-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
		return
	}
	f.requests = append(f.requests, request)
	writeFakeGCSError(w, http.StatusNotFound)
}

func parseMultipartUpload(contentType string, body []byte) (fakeGCSUpload, []byte) {
	var upload fakeGCSUpload
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/related" {
		return upload, nil
	}
	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	metadataPart, err := reader.NextPart()
	if err != nil {
		return upload, nil
	}
	metadata, err := io.ReadAll(metadataPart)
	_ = metadataPart.Close()
	if err != nil || json.Unmarshal(metadata, &upload) != nil {
		return fakeGCSUpload{}, nil
	}
	mediaPart, err := reader.NextPart()
	if err != nil {
		return upload, nil
	}
	data, err := io.ReadAll(mediaPart)
	_ = mediaPart.Close()
	if err != nil {
		return upload, nil
	}
	return upload, data
}

func writeFakeGCSObject(w http.ResponseWriter, upload fakeGCSUpload, size int) {
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	_, _ = fmt.Fprintf(w, `{"kind":"storage#object","name":%q,"bucket":"private-test-bucket","size":"%d","generation":"1","metageneration":"1"}`, upload.Name, size)
}

func writeFakeGCSError(w http.ResponseWriter, status int) {
	w.Header().Set("Content-Type", "application/json; charset=UTF-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":{"code":%d,"message":%q}}`, status, fakeStorageSecret)
}

func objectNameFromPath(path string) string {
	_, name, ok := strings.Cut(path, "/o/")
	if !ok {
		return ""
	}
	decoded, err := url.PathUnescape(name)
	if err != nil {
		return ""
	}
	return decoded
}

func (f *fakeGCS) newBucket(t *testing.T) (*storage.Client, *storage.BucketHandle) {
	t.Helper()
	client, err := storage.NewClient(context.Background(),
		option.WithEndpoint(f.server.URL+"/storage/v1/"),
		option.WithHTTPClient(f.server.Client()),
		option.WithoutAuthentication(),
		storage.WithJSONReads(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return client, client.Bucket("private-test-bucket")
}

func setAppBucket(t *testing.T, app *App, f *fakeGCS) {
	t.Helper()
	client, bucket := f.newBucket(t)
	app.storageClient = client
	app.bucket = bucket
	app.Config.UploadBucket = "private-test-bucket"
}

func (f *fakeGCS) object(name string) (fakeGCSObject, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	object, ok := f.objects[name]
	return object, ok
}

func (f *fakeGCS) requestSnapshot() []fakeGCSRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeGCSRequest(nil), f.requests...)
}

func TestCloudStorageSDKCreateOnlyPrivateObjectsAndSanitizedErrors(t *testing.T) {
	fake := newFakeGCS(t)
	client, bucket := fake.newBucket(t)
	app := &App{Config: Config{UploadBucket: "private-test-bucket"}, storageClient: client, bucket: bucket}
	ctx := context.Background()
	data := bytes.Repeat([]byte("x"), (1<<20)+1)
	if err := app.writeUpload(ctx, "first.original", data); err != nil {
		t.Fatalf("upload: %v requests=%+v", err, fake.requestSnapshot())
	}
	object, ok := fake.object("first.original")
	if !ok || !bytes.Equal(object.Data, data) {
		t.Fatal("object was not finalized in fake bucket")
	}
	if object.ContentType != "application/octet-stream" || object.CacheControl != "private, no-store" {
		t.Fatalf("object metadata is not private: content_type=%q cache_control=%q", object.ContentType, object.CacheControl)
	}
	var initiated bool
	for _, request := range fake.requestSnapshot() {
		if request.Method == http.MethodPost && strings.Contains(request.URI, "/upload/storage/v1/b/") {
			initiated = true
			if request.Query.Get("ifGenerationMatch") != "0" || request.Query.Get("uploadType") != "resumable" {
				t.Fatalf("upload was not create-only resumable: %s", request.URI)
			}
			if request.Upload.CacheControl != "private, no-store" || request.Upload.ContentType != "application/octet-stream" {
				t.Fatalf("resumable metadata was not private: %+v", request.Upload)
			}
		}
	}
	if !initiated {
		t.Fatal("storage SDK did not initiate a resumable upload")
	}
	if err := app.writeUpload(ctx, "first.original", data); err == nil || strings.Contains(err.Error(), fakeStorageSecret) {
		t.Fatalf("create-only collision was accepted or leaked storage error: %v", err)
	}

	fake.failFinalize = func(name string) bool { return name == "finalize-fails" }
	if err := app.writeUpload(ctx, "finalize-fails", data); err == nil || err.Error() != "upload storage finalize failed" || strings.Contains(err.Error(), fakeStorageSecret) {
		t.Fatalf("finalize failure was not sanitized: %v", err)
	}
	fake.failRead = true
	if _, err := app.openUpload(ctx, "first.original"); err == nil || err.Error() != "upload storage read failed" || strings.Contains(err.Error(), fakeStorageSecret) {
		t.Fatalf("read failure was not sanitized: %v", err)
	}
	fake.failListing = true
	if _, err := app.uploadBytes(ctx); err == nil || err.Error() != "upload storage listing failed" || strings.Contains(err.Error(), fakeStorageSecret) {
		t.Fatalf("listing failure was not sanitized: %v", err)
	}
}

func TestCloudStorageSharedAcrossAppsAndAuthorizedMediaExport(t *testing.T) {
	fake := newFakeGCS(t)
	app, pool := timelineApp(t)
	setAppBucket(t, app, fake)
	defer app.Close()
	otherApp := appForPool(t, pool, app.auth.issuer)
	setAppBucket(t, otherApp, fake)
	defer otherApp.Close()

	category := createPhotoCategory(t, app, pool, nil)
	original := testJPEG(t)
	sub := decodeSubmission(t, photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{
		"category_id": category.ID, "idempotency_key": "private-cloud-photo-0001", "caption": "Private original",
	}, "private.jpg", original))
	if len(sub.Attachments) != 1 {
		t.Fatalf("upload did not return an attachment: %d", len(sub.Attachments))
	}
	attachment := sub.Attachments[0]
	var originalKey, previewKey string
	if err := pool.QueryRow(context.Background(), "SELECT storage_key,preview_key FROM attachments WHERE id=$1", attachment.ID).Scan(&originalKey, &previewKey); err != nil {
		t.Fatal(err)
	}
	storedOriginal, originalExists := fake.object(originalKey)
	storedPreview, previewExists := fake.object(previewKey)
	if !originalExists || !previewExists || !bytes.Equal(storedOriginal.Data, original) {
		t.Fatal("database record committed before both durable cloud objects were finalized")
	}
	for _, stored := range []fakeGCSObject{storedOriginal, storedPreview} {
		if stored.CacheControl != "private, no-store" {
			t.Fatalf("cloud object cache policy was not private: %q", stored.CacheControl)
		}
	}
	preview, _, err := imagePreview(original)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedPreview.Data, preview) {
		t.Fatal("durable preview bytes differ from generated preview")
	}

	attachmentURL := "/api/v1/attachments/" + attachment.ID
	for _, reader := range []string{MiaID, ManagerID} {
		res := authenticatedRequest(t, otherApp, pool, reader, http.MethodGet, attachmentURL, "")
		if res.Code != http.StatusOK || !bytes.Equal(res.Body.Bytes(), original) || res.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("original was not readable from another app by %s: status=%d cache=%q", reader, res.Code, res.Header().Get("Cache-Control"))
		}
	}
	if res := authenticatedRequest(t, otherApp, pool, LeonID, http.MethodGet, attachmentURL, ""); res.Code != http.StatusNotFound {
		t.Fatalf("another student read a private original: %d", res.Code)
	}
	previewRes := authenticatedRequest(t, otherApp, pool, MiaID, http.MethodGet, attachmentURL+"/preview", "")
	if previewRes.Code != http.StatusOK || !bytes.Equal(previewRes.Body.Bytes(), preview) || previewRes.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("preview was not readable from another app: status=%d cache=%q", previewRes.Code, previewRes.Header().Get("Cache-Control"))
	}

	t.Setenv("TMPDIR", "/nonexistent-cloud-export-spool")
	export := authenticatedRequest(t, otherApp, pool, ManagerID, http.MethodGet, "/api/v1/categories/"+category.ID+"/export", "")
	if export.Code != http.StatusOK {
		t.Fatalf("manager export failed: %d %s", export.Code, export.Body)
	}
	archive, err := zip.NewReader(bytes.NewReader(export.Body.Bytes()), int64(export.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var exportedOriginal []byte
	for _, file := range archive.File {
		if strings.HasPrefix(file.Name, "originals/") {
			reader, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			exportedOriginal, err = io.ReadAll(reader)
			_ = reader.Close()
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	if !bytes.Equal(exportedOriginal, original) {
		t.Fatal("manager export did not contain the original cloud object bytes")
	}

	fake.mu.Lock()
	fake.failRead = true
	fake.mu.Unlock()
	server := httptest.NewServer(otherApp)
	defer server.Close()
	token, _ := sessionFor(t, otherApp, ManagerID)
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/categories/"+category.ID+"/export", nil)
	req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	response, requestErr := server.Client().Do(req)
	if requestErr == nil {
		interrupted, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr == nil {
			t.Fatal("failed cloud archive was presented as a complete download")
		}
		if _, zipErr := zip.NewReader(bytes.NewReader(interrupted), int64(len(interrupted))); zipErr == nil {
			t.Fatal("failed cloud archive had a complete ZIP directory")
		}
		if bytes.Contains(interrupted, []byte(`"error"`)) {
			t.Fatal("JSON error appended to cloud archive")
		}
	}
	var exportAudits int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action='category.exported' AND entity_id=$1", category.ID).Scan(&exportAudits); err != nil {
		t.Fatal(err)
	}
	if exportAudits != 1 {
		t.Fatalf("failed export recorded a success audit: %d", exportAudits)
	}
}

func TestCloudPreviewFinalizeFailureLeavesNoDatabaseReferences(t *testing.T) {
	fake := newFakeGCS(t)
	fake.failFinalize = func(name string) bool { return strings.HasSuffix(name, ".preview.jpg") }
	app, pool := timelineApp(t)
	setAppBucket(t, app, fake)
	defer app.Close()
	category := createPhotoCategory(t, app, pool, nil)
	res := photoRequest(t, app, pool, MiaID, "/api/v1/submissions", map[string]string{
		"category_id": category.ID, "idempotency_key": "preview-finalize-failure-0001",
	}, "fails.jpg", testJPEG(t))
	if res.Code != http.StatusInternalServerError || strings.Contains(res.Body.String(), fakeStorageSecret) {
		t.Fatalf("preview finalize error was not safely reported: status=%d body=%s", res.Code, res.Body)
	}
	for table, query := range map[string]string{
		"submissions": "SELECT count(*) FROM submissions WHERE category_id=$1",
		"attachments": "SELECT count(*) FROM attachments a JOIN submissions s ON s.id=a.submission_id WHERE s.category_id=$1",
		"revisions":   "SELECT count(*) FROM revisions r JOIN submissions s ON s.id=r.submission_id WHERE s.category_id=$1",
	} {
		var count int
		if err := pool.QueryRow(context.Background(), query, category.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("failed cloud upload committed %d %s", count, table)
		}
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	// GCS writes cannot join the database transaction, so a successfully
	// finalized original may remain orphaned when preview finalization fails.
	if len(fake.objects) != 1 {
		t.Fatalf("failed preview finalize left %d durable objects, want the original only", len(fake.objects))
	}
	for name := range fake.objects {
		if !strings.HasSuffix(name, ".original") {
			t.Fatalf("unexpected object finalized before preview failure")
		}
	}
}
