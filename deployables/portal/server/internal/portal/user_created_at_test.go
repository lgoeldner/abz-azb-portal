package portal

import (
	"context"
	"testing"
	"time"
)

func TestUserCreatedAtMigrationBackfillsFromAuditLog(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	const traced, silent = "40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"
	// Rewind the schema to its pre-003 shape with users already present.
	for _, q := range []string{
		"ALTER TABLE users DROP COLUMN created_at",
		"DELETE FROM schema_migrations WHERE version='003_user_created_at.sql'",
		"INSERT INTO users(id,subject,name) VALUES('" + traced + "','traced','Traced'),('" + silent + "','silent','Silent')",
		"INSERT INTO audit_events(id,actor_id,action,entity_id,created_at) VALUES('40000000-0000-4000-8000-0000000000b1','" + traced + "','submission.saved','40000000-0000-4000-8000-0000000000c1',now()-interval '10 days')",
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate existing database: %v", err)
	}
	for id, want := range map[string]time.Duration{traced: 10 * 24 * time.Hour, silent: 0} {
		var created time.Time
		if err := pool.QueryRow(ctx, "SELECT created_at FROM users WHERE id=$1", id).Scan(&created); err != nil {
			t.Fatal(err)
		}
		if age := time.Since(created); age < want-time.Hour || age > want+time.Hour {
			t.Fatalf("user %s created_at=%v (age %v), want about %v old", id, created, age, want)
		}
	}
}
