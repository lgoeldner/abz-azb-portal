package portal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// BlobStore holds attachment originals and previews. Keys are unique per attachment and never written twice,
// so no conditional or overwrite-protecting write is needed. Missing keys report os.ErrNotExist; Remove of a
// missing key succeeds.
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte) error
	Open(ctx context.Context, key string) (io.ReadSeekCloser, time.Time, error)
	Remove(ctx context.Context, key string) error
	Bytes(ctx context.Context) (int64, error)
}

// NewBlobStore returns the S3 store when S3 is configured and the disk store otherwise.
func NewBlobStore(c Config) BlobStore {
	if !c.S3.configured() {
		return diskStore{c.UploadDir}
	}
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(c.S3.Endpoint),
		Region:       c.S3.Region,
		Credentials:  credentials.NewStaticCredentialsProvider(c.S3.AccessKey, c.S3.SecretKey, ""),
		UsePathStyle: true,
		// Newer SDKs add CRC checksums by default; third-party S3 services can reject them.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return s3Store{client, c.S3.Bucket}
}

type S3Config struct{ Endpoint, Region, Bucket, AccessKey, SecretKey string }

func loadS3Config() S3Config {
	return S3Config{os.Getenv("S3_ENDPOINT"), os.Getenv("S3_REGION"), os.Getenv("S3_BUCKET"), os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY")}
}
func (s S3Config) configured() bool { return s != S3Config{} }
func (s S3Config) validate() error {
	if !s.configured() {
		return nil
	}
	if s.Endpoint == "" || s.Region == "" || s.Bucket == "" || s.AccessKey == "" || s.SecretKey == "" {
		return errors.New("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY must all be set together")
	}
	if _, err := originURL(s.Endpoint); err != nil {
		return errors.New("S3_ENDPOINT must be an HTTP(S) origin")
	}
	return nil
}

type diskStore struct{ dir string }

func (d diskStore) path(key string) string { return filepath.Join(d.dir, filepath.Clean("/"+key)) }
func (d diskStore) Put(_ context.Context, key string, data []byte) error {
	return immutableWrite(d.path(key), data)
}
func (d diskStore) Open(_ context.Context, key string) (io.ReadSeekCloser, time.Time, error) {
	f, e := os.Open(d.path(key))
	if e != nil {
		return nil, time.Time{}, e
	}
	st, e := f.Stat()
	if e != nil {
		f.Close()
		return nil, time.Time{}, e
	}
	return f, st.ModTime(), nil
}
func (d diskStore) Remove(_ context.Context, key string) error {
	if e := os.Remove(d.path(key)); e != nil && !errors.Is(e, os.ErrNotExist) {
		return e
	}
	return nil
}
func (d diskStore) Bytes(context.Context) (int64, error) { return diskBytes(d.dir) }

type s3Store struct {
	c      *s3.Client
	bucket string
}

type bufferedBlob struct{ *bytes.Reader }

func (bufferedBlob) Close() error { return nil }

func (s s3Store) Put(ctx context.Context, key string, data []byte) error {
	_, e := s.c.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.bucket, Key: &key, Body: bytes.NewReader(data), ContentLength: aws.Int64(int64(len(data)))})
	return e
}

// Open buffers the object; originals are capped at maxImageBytes.
func (s s3Store) Open(ctx context.Context, key string) (io.ReadSeekCloser, time.Time, error) {
	out, e := s.c.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if e != nil {
		var missing *types.NoSuchKey
		if errors.As(e, &missing) {
			return nil, time.Time{}, fmt.Errorf("%w", os.ErrNotExist)
		}
		return nil, time.Time{}, e
	}
	defer out.Body.Close()
	data, e := io.ReadAll(out.Body)
	if e != nil {
		return nil, time.Time{}, e
	}
	return bufferedBlob{bytes.NewReader(data)}, aws.ToTime(out.LastModified), nil
}
func (s s3Store) Remove(ctx context.Context, key string) error {
	_, e := s.c.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
	return e
}
func (s s3Store) Bytes(ctx context.Context) (int64, error) {
	var total int64
	pages := s3.NewListObjectsV2Paginator(s.c, &s3.ListObjectsV2Input{Bucket: &s.bucket})
	for pages.HasMorePages() {
		page, e := pages.NextPage(ctx)
		if e != nil {
			return 0, e
		}
		for _, o := range page.Contents {
			total += aws.ToInt64(o.Size)
		}
	}
	return total, nil
}
