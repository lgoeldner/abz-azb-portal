package portal

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

// setupUploads keeps local development unchanged. Cloud Run uses ADC and a
// private bucket; objects are never exposed through public or signed URLs.
func (a *App) setupUploads(ctx context.Context) error {
	if a.Config.UploadBucket == "" {
		return os.MkdirAll(a.Config.UploadDir, 0700)
	}
	if a.Config.Env == "production" && os.Getenv("STORAGE_EMULATOR_HOST") != "" {
		return errors.New("storage emulator forbidden in production")
	}
	client, err := storage.NewClient(ctx, storage.WithJSONReads())
	if err != nil {
		return errors.New("cannot initialize private upload storage")
	}
	a.storageClient = client
	a.bucket = client.Bucket(a.Config.UploadBucket)
	// A decoded 24MP image plus its preview needs considerably more than its
	// compressed size. Bound image work independently of HTTP concurrency.
	a.imageSlots = make(chan struct{}, 1)
	return nil
}

func (a *App) Close() {
	if a.storageClient != nil {
		_ = a.storageClient.Close()
	}
}

func validStorageKey(key string) bool {
	return filepath.Base(key) == key && !bytes.ContainsAny([]byte(key), "/\\") && key != "." && key != ""
}

func (a *App) writeUpload(ctx context.Context, key string, data []byte) error {
	if !validStorageKey(key) {
		return errors.New("invalid upload key")
	}
	if a.bucket == nil {
		return immutableWrite(filepath.Join(a.Config.UploadDir, key), data)
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	writer := a.bucket.Object(key).If(storage.Conditions{DoesNotExist: true}).NewWriter(ctx)
	writer.ContentType = "application/octet-stream"
	writer.CacheControl = "private, no-store"
	writer.ChunkSize = 1 << 20
	if _, err := writer.Write(data); err != nil {
		// Cancellation aborts the unfinished object; Close must not finalize it.
		cancel()
		_ = writer.Close()
		return errors.New("upload storage write failed")
	}
	// Close is the durable finalize, not just cleanup. Never commit a database
	// reference until both original and preview have finalized successfully.
	if err := writer.Close(); err != nil {
		return errors.New("upload storage finalize failed")
	}
	return nil
}

func (a *App) openUpload(ctx context.Context, key string) (io.ReadCloser, error) {
	if !validStorageKey(key) {
		return nil, errors.New("invalid upload key")
	}
	if a.bucket == nil {
		return os.Open(filepath.Join(a.Config.UploadDir, key))
	}
	reader, err := a.bucket.Object(key).NewReader(ctx)
	if err != nil {
		return nil, errors.New("upload storage read failed")
	}
	return reader, nil
}

func (a *App) serveCloudUpload(w http.ResponseWriter, r *http.Request, key, filename string) error {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	reader, err := a.openUpload(ctx, key)
	if err != nil {
		return err
	}
	defer reader.Close()
	// Bounded buffering retains conditional/range support without a public URL
	// or an instance-local durable file. Validated originals are at most 20MiB.
	data, err := io.ReadAll(io.LimitReader(reader, maxImageBytes+1))
	if err != nil || len(data) > maxImageBytes {
		return errors.New("upload storage read failed")
	}
	http.ServeContent(w, r, filename, time.Time{}, bytes.NewReader(data))
	return nil
}

func (a *App) uploadBytes(ctx context.Context) (int64, error) {
	if a.bucket == nil {
		return diskBytes(a.Config.UploadDir)
	}
	var total int64
	objects := a.bucket.Objects(ctx, &storage.Query{})
	for {
		object, err := objects.Next()
		if errors.Is(err, iterator.Done) {
			return total, nil
		}
		if err != nil {
			return 0, errors.New("upload storage listing failed")
		}
		total += object.Size
	}
}
