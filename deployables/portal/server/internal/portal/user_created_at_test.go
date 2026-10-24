package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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

func TestAdminUserListCarriesStableCreatedAt(t *testing.T) {
	app, pool := timelineApp(t)
	list := func() map[string]User {
		res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/admin/users", "")
		var users []User
		if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &users) != nil {
			t.Fatalf("list users: %d %s", res.Code, res.Body)
		}
		out := map[string]User{}
		for _, u := range users {
			if u.CreatedAt.IsZero() {
				t.Fatalf("user %s has no created_at", u.ID)
			}
			out[u.ID] = u
		}
		return out
	}
	before := list()[PendingID]
	// Admitting someone must not reset when they signed up.
	body := fmt.Sprintf(`{"name":%q,"role":"student","admitted":true,"cohort_member":true,"category_ids":[]}`, before.Name)
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/admin/users/"+PendingID, body); res.Code != http.StatusOK {
		t.Fatalf("admit: %d %s", res.Code, res.Body)
	}
	if after := list()[PendingID]; !after.Admitted || !after.CreatedAt.Equal(before.CreatedAt) {
		t.Fatalf("admitting changed created_at %v -> %v (admitted=%v)", before.CreatedAt, after.CreatedAt, after.Admitted)
	}
}
