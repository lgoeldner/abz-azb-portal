package portal

import (
	"context"
	"io"
	"testing"
)

// Invariant: the preview seed leaves every collection kind, submission and poll status, ballots, corrections and
// photos in the database, the stored blobs are readable, and a second run changes nothing.
func TestPreviewSeedCoversEveryDataKind(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	blobs := diskStore{t.TempDir()}
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	if err := SeedPreview(ctx, pool, blobs, "development"); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"idea", "quote", "memory", "photo", "steckbrief", "person", "proposal", "words"} {
		if n := countRows(t, pool, "SELECT count(*) FROM categories WHERE kind=$1", kind); n < 1 {
			t.Errorf("no %s collection seeded", kind)
		}
	}
	for _, status := range []string{"pending", "accepted", "rejected", "withdrawn"} {
		if n := countRows(t, pool, "SELECT count(*) FROM submissions WHERE status=$1", status); n < 1 {
			t.Errorf("no %s submission seeded", status)
		}
	}
	for _, status := range []string{"draft", "open", "closed"} {
		if n := countRows(t, pool, "SELECT count(*) FROM categories WHERE kind IN ('person','proposal','words') AND status=$1", status); n < 1 {
			t.Errorf("no %s poll seeded", status)
		}
	}
	for name, query := range map[string]string{
		"ballots":                 "SELECT count(*) FROM ballots",
		"ballot audit":            "SELECT count(*) FROM ballot_audit",
		"open correction":         "SELECT count(*) FROM corrections WHERE NOT resolved",
		"resolved correction":     "SELECT count(*) FROM corrections WHERE resolved",
		"steckbrief submission":   "SELECT count(*) FROM submissions s JOIN categories c ON c.id=s.category_id WHERE c.kind='steckbrief'",
		"steckbrief slot photo":   "SELECT count(*) FROM attachments WHERE caption IN ('foto','kinderfoto')",
		"photo attachment":        "SELECT count(*) FROM attachments a JOIN submissions s ON s.id=a.submission_id JOIN categories c ON c.id=s.category_id WHERE c.kind='photo'",
		"revision per submission": "SELECT count(*) FROM submissions s WHERE NOT EXISTS(SELECT 1 FROM revisions r WHERE r.submission_id=s.id)",
	} {
		n := countRows(t, pool, query)
		if name == "revision per submission" {
			if n != 0 {
				t.Errorf("%d submissions without a revision", n)
			}
		} else if n < 1 {
			t.Errorf("no %s seeded", name)
		}
	}
	rows, err := pool.Query(ctx, "SELECT storage_key,preview_key FROM attachments")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var original, preview string
		if err = rows.Scan(&original, &preview); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{original, preview} {
			f, _, err := blobs.Open(ctx, key)
			if err != nil {
				t.Fatalf("blob %s: %v", key, err)
			}
			if data, _ := io.ReadAll(f); len(data) == 0 {
				t.Fatalf("blob %s is empty", key)
			}
			_ = f.Close()
		}
	}
	before := countRows(t, pool, "SELECT (SELECT count(*) FROM submissions)+(SELECT count(*) FROM ballots)+(SELECT count(*) FROM attachments)")
	if err = SeedPreview(ctx, pool, blobs, "development"); err != nil {
		t.Fatal(err)
	}
	if after := countRows(t, pool, "SELECT (SELECT count(*) FROM submissions)+(SELECT count(*) FROM ballots)+(SELECT count(*) FROM attachments)"); after != before {
		t.Fatalf("second preview seed changed rows: %d -> %d", before, after)
	}
	if err = SeedPreview(ctx, pool, blobs, "production"); err == nil {
		t.Fatal("preview seed ran in production")
	}
}
