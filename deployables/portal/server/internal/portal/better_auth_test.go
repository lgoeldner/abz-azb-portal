package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDependencySessionAuthorizationAndCSRF(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	var unavailable atomic.Bool
	var mode atomic.Value
	mode.Store("better_auth")
	secret := strings.Repeat("s", 40)
	identity := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/session" || r.Header.Get("Authorization") != "Bearer "+secret {
			w.WriteHeader(403)
			return
		}
		if unavailable.Load() {
			w.WriteHeader(503)
			return
		}
		cookie, err := r.Cookie("ba_session")
		if err != nil {
			w.WriteHeader(401)
			return
		}
		uid := MiaID
		if cookie.Value == "admin" {
			uid = AdminID
		}
		jsonOut(w, 200, map[string]any{"user_id": uid, "session_id": "90000000-0000-4000-8000-000000000001", "expires_at": time.Now().Add(time.Hour), "mode": mode.Load()})
	}))
	defer identity.Close()
	server := httptest.NewUnstartedServer(nil)
	cfg := Config{Env: "development", DatabaseURL: "unused", PublicURL: "http://" + server.Listener.Addr().String(), AuthMode: "better_auth", AuthInternalURL: identity.URL, AuthServiceSecret: secret, SessionSecret: secret, UploadDir: t.TempDir(), StaticDir: t.TempDir(), Mail: MailConfig{Provider: "capture", DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150}}
	cfg.Mail.PublicURL = cfg.PublicURL
	app, err := New(ctx, cfg, pool)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = app
	server.Start()
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	call := func(method, path, body, csrfToken string) *http.Response {
		req, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", csrfToken)
		req.Header.Set("Origin", server.URL)
		req.Header.Set("X-User-Id", AdminID)
		req.Header.Set("X-User-Role", "admin")
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	req, _ := http.NewRequest("GET", server.URL, nil)
	jar.SetCookies(req.URL, []*http.Cookie{{Name: "ba_session", Value: "mia", Path: "/"}})
	res := call("GET", "/api/v1/me", "", "")
	if res.StatusCode != 200 {
		t.Fatalf("me: %d", res.StatusCode)
	}
	var me struct {
		User User   `json:"user"`
		CSRF string `json:"csrf_token"`
	}
	if err = json.NewDecoder(res.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	if me.User.ID != MiaID || me.CSRF == "" {
		t.Fatal("dependency identity or CSRF missing")
	}
	if res = call("GET", "/api/v1/admin/email/status", "", ""); res.StatusCode != 403 {
		t.Fatalf("forged role bypass: %d", res.StatusCode)
	}
	if res = call("PATCH", "/api/v1/me/email-reminders", `{"enabled":false}`, ""); res.StatusCode != 403 {
		t.Fatalf("missing CSRF: %d", res.StatusCode)
	}
	if res = call("PATCH", "/api/v1/me/email-reminders", `{"enabled":false}`, me.CSRF); res.StatusCode != 200 {
		t.Fatalf("valid CSRF: %d", res.StatusCode)
	}
	var enabled bool
	if err = pool.QueryRow(ctx, "SELECT email_reminders_enabled FROM users WHERE id=$1", MiaID).Scan(&enabled); err != nil || enabled {
		t.Fatal("preference was not saved")
	}
	if _, err = pool.Exec(ctx, "UPDATE users SET login_enabled=false WHERE id=$1", MiaID); err != nil {
		t.Fatal(err)
	}
	if res = call("GET", "/api/v1/me", "", ""); res.StatusCode != 401 {
		t.Fatalf("disabled account accepted: %d", res.StatusCode)
	}
	jar.SetCookies(req.URL, []*http.Cookie{{Name: "ba_session", Value: "admin", Path: "/"}})
	if res = call("GET", "/api/v1/admin/email/status", "", ""); res.StatusCode != 200 {
		t.Fatalf("admin status: %d", res.StatusCode)
	}
	mode.Store("mock")
	if res = call("GET", "/api/v1/me", "", ""); res.StatusCode != 401 {
		t.Fatalf("mock identity accepted in real mode: %d", res.StatusCode)
	}
	mode.Store("better_auth")
	unavailable.Store(true)
	if res = call("GET", "/api/v1/me", "", ""); res.StatusCode != 503 {
		t.Fatalf("auth outage failed open: %d", res.StatusCode)
	}
}
func TestDependencyConfigAndMaintenance(t *testing.T) {
	cfg := Config{Env: "production", DatabaseURL: "unused", AuthMode: "better_auth", PublicURL: "https://portal.example.org", AuthInternalURL: "http://auth:3000", AuthServiceSecret: strings.Repeat("s", 32), SessionSecret: strings.Repeat("c", 32), UploadDir: "/uploads", StaticDir: "/static", Mail: MailConfig{Provider: "brevo", APIKey: "synthetic", From: "test@example.test"}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg.AuthMode = "mock"
	if cfg.Validate() == nil {
		t.Fatal("production mock accepted")
	}
	cfg.AuthMode = "better_auth"
	cfg.AuthInternalURL = "http://auth:3000/internal?token=x"
	if cfg.Validate() == nil {
		t.Fatal("unsafe internal URL accepted")
	}
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "unused")
	t.Setenv("AUTH_MODE", "better_auth")
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("AUTH_SERVICE_SECRET", "")
	if _, err := LoadConfigForCommand("users"); err != nil {
		t.Fatalf("maintenance depended on providers: %v", err)
	}
}
func TestAuthModeChangesRevokeSessionsPermanently(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	app := &App{DB: pool, Config: Config{AuthMode: "better_auth"}}
	if err := app.syncAuthMode(ctx); err != nil {
		t.Fatal(err)
	}
	_, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES($1,$2,'synthetic',now()+interval '1 hour')", ID(), MiaID)
	if err != nil {
		t.Fatal(err)
	}
	app.Config.AuthMode = "mock"
	if err = app.syncAuthMode(ctx); err != nil {
		t.Fatal(err)
	}
	app.Config.AuthMode = "better_auth"
	if err = app.syncAuthMode(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM auth_sessions").Scan(&count); err != nil || count != 0 {
		t.Fatal("away/back revived session")
	}
}

func TestTrustedForwardedClientIdentity(t *testing.T) {
	app := &App{Config: Config{TrustedProxyCIDRs: "10.0.0.0/24"}}
	for _, tc := range []struct{ peer, forwarded, want string }{
		{"192.0.2.1:1234", "198.51.100.1", "192.0.2.1"},
		{"10.0.0.2:1234", "198.51.100.1", "198.51.100.1"},
		{"10.0.0.2:1234", "forged, 192.0.2.4", "192.0.2.4"},
		{"10.0.0.2:1234", "bad", "10.0.0.2"},
	} {
		r := httptest.NewRequest("GET", "/auth/login", nil)
		r.RemoteAddr = tc.peer
		r.Header.Set("X-Forwarded-For", tc.forwarded)
		if got := app.clientIP(r); got != tc.want {
			t.Errorf("client IP=%s want=%s", got, tc.want)
		}
	}
}

func TestAuthenticatedProxyHeader(t *testing.T) {
	app := &App{Config: Config{AuthServiceSecret: strings.Repeat("p", 32)}}
	r := httptest.NewRequest("GET", "/auth/login", nil)
	r.RemoteAddr = "10.2.3.4:1234"
	r.Header.Set("X-Forwarded-For", "198.51.100.4")
	r.Header.Set("X-Portal-Proxy-Token", "wrong")
	if app.clientIP(r) != "10.2.3.4" {
		t.Fatal("forged proxy trusted")
	}
	r.Header.Set("X-Portal-Proxy-Token", app.Config.AuthServiceSecret)
	if app.clientIP(r) != "198.51.100.4" {
		t.Fatal("authenticated proxy lost client identity")
	}
}
