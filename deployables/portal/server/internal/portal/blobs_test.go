package portal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// testStores returns the storage configs a test should cover: always disk, plus S3Mock when
// TEST_S3_ENDPOINT is set. S3 configs get a fresh private bucket.
func testStoreConfig(t *testing.T) Config {
	t.Helper()
	endpoint := os.Getenv("TEST_S3_ENDPOINT")
	if endpoint == "" {
		return Config{UploadDir: t.TempDir()}
	}
	c := Config{UploadDir: t.TempDir(), S3: S3Config{endpoint, "eu-central-3", fmt.Sprintf("portal-test-%x", time.Now().UnixNano()), "test", "test"}}
	client := NewBlobStore(c).(s3Store).c
	ctx := context.Background()
	if _, err := client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &c.S3.Bucket}); err != nil {
		t.Fatalf("create test bucket: %v", err)
	}
	t.Cleanup(func() {
		for _, k := range storedKeys(t, c) {
			_ = NewBlobStore(c).Remove(ctx, k)
		}
		_, _ = client.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: &c.S3.Bucket})
	})
	return c
}

// storedKeys lists every object in the configured store.
func storedKeys(t *testing.T, c Config) []string {
	t.Helper()
	var keys []string
	if s, ok := NewBlobStore(c).(s3Store); ok {
		pages := s3.NewListObjectsV2Paginator(s.c, &s3.ListObjectsV2Input{Bucket: &s.bucket})
		for pages.HasMorePages() {
			page, err := pages.NextPage(context.Background())
			if err != nil {
				t.Fatalf("list bucket: %v", err)
			}
			for _, o := range page.Contents {
				keys = append(keys, aws.ToString(o.Key))
			}
		}
		return keys
	}
	entries, err := os.ReadDir(c.UploadDir)
	if err != nil {
		t.Fatalf("list upload dir: %v", err)
	}
	for _, e := range entries {
		keys = append(keys, e.Name())
	}
	return keys
}

func TestBlobStoreContract(t *testing.T) {
	ctx := context.Background()
	c := testStoreConfig(t)
	configs := map[string]Config{"disk": {UploadDir: t.TempDir()}}
	if c.S3.configured() {
		configs["s3"] = c
	}
	for name, cfg := range configs {
		t.Run(name, func(t *testing.T) {
			store := NewBlobStore(cfg)
			if _, _, err := store.Open(ctx, "missing"); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("open missing = %v, want ErrNotExist", err)
			}
			if err := store.Remove(ctx, "missing"); err != nil {
				t.Fatalf("remove missing: %v", err)
			}
			if err := store.Put(ctx, "a.original", []byte("hello")); err != nil {
				t.Fatal(err)
			}
			f, _, err := store.Open(ctx, "a.original")
			if err != nil {
				t.Fatal(err)
			}
			got, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil || string(got) != "hello" {
				t.Fatalf("read back %q err=%v", got, err)
			}
			if n, err := store.Bytes(ctx); err != nil || n != 5 {
				t.Fatalf("bytes=%d err=%v", n, err)
			}
			if err := store.Remove(ctx, "a.original"); err != nil {
				t.Fatal(err)
			}
			if _, _, err := store.Open(ctx, "a.original"); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("open removed = %v", err)
			}
		})
	}
	// Disk refuses to overwrite; S3 relies on unique keys instead, so only disk is asserted.
	disk := NewBlobStore(Config{UploadDir: t.TempDir()})
	if err := disk.Put(ctx, "k", []byte("1")); err != nil {
		t.Fatal(err)
	}
	if err := disk.Put(ctx, "k", []byte("2")); err == nil {
		t.Fatal("disk store overwrote an existing key")
	}
}

func TestS3ConfigRules(t *testing.T) {
	full := S3Config{"http://s3:9090", "eu", "bucket", "ak", "sk"}
	if err := full.validate(); err != nil {
		t.Fatal(err)
	}
	partial := full
	partial.SecretKey = ""
	if err := partial.validate(); err == nil {
		t.Fatal("partial S3 config accepted")
	}
	if err := (S3Config{}).validate(); err != nil || (S3Config{}).configured() {
		t.Fatal("empty S3 config must mean disk")
	}
	prod := Config{Env: "production", DatabaseURL: "postgres://x", PublicURL: "https://p.example", AuthMode: "better_auth", AuthInternalURL: "http://auth:3000", AuthServiceSecret: strings.Repeat("s", 32), SessionSecret: strings.Repeat("c", 32), UploadDir: "/u", StaticDir: "/s", S3: full, Mail: MailConfig{Provider: "brevo", APIKey: "k", From: "t@example.test"}}
	if err := prod.Validate(); err == nil || !strings.Contains(err.Error(), "S3") {
		t.Fatalf("production S3 must be refused until backup exists: %v", err)
	}
}

// TestS3SmokeOptIn exercises a real S3 service (IONOS) with synthetic data. Set all S3_SMOKE_* variables
// to a throwaway bucket to run it.
func TestS3SmokeOptIn(t *testing.T) {
	c := Config{S3: S3Config{os.Getenv("S3_SMOKE_ENDPOINT"), os.Getenv("S3_SMOKE_REGION"), os.Getenv("S3_SMOKE_BUCKET"), os.Getenv("S3_SMOKE_ACCESS_KEY"), os.Getenv("S3_SMOKE_SECRET_KEY")}}
	if !c.S3.configured() {
		t.Skip("S3_SMOKE_* not set; skipped real S3 smoke test")
	}
	if err := c.S3.validate(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store := NewBlobStore(c)
	key := fmt.Sprintf("smoke-%x.original", time.Now().UnixNano())
	if err := store.Put(ctx, key, []byte("synthetic")); err != nil {
		t.Fatalf("put: %v", err)
	}
	f, _, err := store.Open(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	got, _ := io.ReadAll(f)
	_ = f.Close()
	if string(got) != "synthetic" {
		t.Fatalf("read back %q", got)
	}
	if err := store.Remove(ctx, key); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := store.Open(ctx, key); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("object still readable after delete: %v", err)
	}
}

// failingStore fails every write; used to prove a failed upload exposes nothing.
type failingStore struct{ BlobStore }

func (failingStore) Put(context.Context, string, []byte) error { return errors.New("store down") }
