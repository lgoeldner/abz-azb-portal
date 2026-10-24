package portal

import (
	"abizeitbetrug/server/internal/authmock"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminUserDeleteInvariants(t *testing.T) {
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
	del := func(actor, id string) *httptest.ResponseRecorder {
		return authenticatedRequest(t, app, pool, actor, http.MethodDelete, "/api/v1/admin/users/"+id, "")
	}
	exists := func(id string) bool {
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	listed := func(id string) bool {
		res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/admin/users", "")
		if res.Code != http.StatusOK {
			t.Fatalf("list users status=%d", res.Code)
		}
		return strings.Contains(res.Body.String(), id)
	}
	code := func(res *httptest.ResponseRecorder) string {
		if i := strings.Index(res.Body.String(), `"code":"`); i >= 0 {
			rest := res.Body.String()[i+8:]
			return rest[:strings.Index(rest, `"`)]
		}
		return ""
	}
	fresh := "00000000-0000-4000-8000-0000000000f1"
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted) VALUES($1,'fresh-subject','Fresh','student',true)", fresh); err != nil {
		t.Fatal(err)
	}
	// A live session of the doomed user must not block deletion and must vanish.
	authenticatedRequest(t, app, pool, fresh, http.MethodGet, "/api/v1/me", "")

	// Non-admins are refused and nothing is deleted.
	for _, actor := range []string{MiaID, ManagerID} {
		if res := del(actor, fresh); res.Code != http.StatusForbidden || !exists(fresh) {
			t.Fatalf("non-admin %s delete status=%d exists=%v", actor, res.Code, exists(fresh))
		}
	}
	// Unknown and malformed ids are 404.
	for _, id := range []string{"00000000-0000-4000-8000-0000000000ee", "not-an-id"} {
		if res := del(AdminID, id); res.Code != http.StatusNotFound {
			t.Fatalf("delete %q status=%d", id, res.Code)
		}
	}
	// Self-delete is refused.
	if res := del(AdminID, AdminID); res.Code != http.StatusConflict || code(res) != "self_delete" || !exists(AdminID) {
		t.Fatalf("self delete status=%d body=%s", res.Code, res.Body)
	}
	// Users with submissions keep their account and history.
	if res := del(AdminID, MiaID); res.Code != http.StatusConflict || code(res) != "has_content" || !exists(MiaID) {
		t.Fatalf("user with content status=%d body=%s", res.Code, res.Body)
	}
	// With another admitted admin present, a content-free admin can be deleted. The last_admin
	// guard is unreachable over HTTP (the only admitted admin is always the actor, hence self_delete).
	second := "00000000-0000-4000-8000-0000000000f2"
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted) VALUES($1,'second-admin','Second','admin',true)", second); err != nil {
		t.Fatal(err)
	}
	if res := del(AdminID, second); res.Code != http.StatusNoContent || exists(second) {
		t.Fatalf("delete second admin status=%d body=%s", res.Code, res.Body)
	}

	// A content-free user is deleted, sessions go, audit is written, listing no longer shows them.
	if res := del(AdminID, fresh); res.Code != http.StatusNoContent || res.Body.Len() != 0 {
		t.Fatalf("delete status=%d body=%s", res.Code, res.Body)
	}
	if exists(fresh) || listed(fresh) {
		t.Fatal("deleted user still present")
	}
	var sessions, events int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id=$1", fresh).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE action='user.deleted' AND entity_id=$1 AND actor_id=$2", fresh, AdminID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if sessions != 0 || events != 1 {
		t.Fatalf("sessions=%d audit events=%d", sessions, events)
	}
	if res := del(AdminID, fresh); res.Code != http.StatusNotFound {
		t.Fatalf("repeat delete status=%d", res.Code)
	}
}
