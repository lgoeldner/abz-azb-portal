package portal

import (
	"abizeitbetrug/auth-mock/authmock"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// rawRequest authenticates without granting consent, unlike authenticatedRequest.
func rawRequest(t *testing.T, app *App, userID, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	token, csrf := randomToken(), randomToken()
	if _, err := app.DB.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(token), userID, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	req.Header.Set("X-CSRF-Token", csrf)
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	return res
}

func TestConsentGateInvariants(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	provider := mockProvider(t, "", "http://localhost:8080", []authmock.User{{Subject: FixtureSubject(MiaID), Name: "Mia", DisplaySlug: "mia_weber"}})
	if err := SeedWithIssuer(ctx, pool, "development", provider.URL); err != nil {
		t.Fatal(err)
	}
	c := Config{Env: "development", DatabaseURL: "unused", PublicURL: "http://localhost:8080", UploadDir: t.TempDir(), StaticDir: t.TempDir(), LegalDir: t.TempDir(), AuthMode: "mock", Issuer: provider.URL, ClientID: "portal-dev", ClientSecret: "dev-only", SessionSecret: strings.Repeat("s", 32)}
	app, err := New(ctx, c, pool)
	if err != nil {
		t.Fatal(err)
	}
	u, v := "00000000-0000-4000-8000-0000000000c1", "00000000-0000-4000-8000-0000000000c2"
	for _, id := range []string{u, v} {
		if _, err := pool.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,$2,'Neu','student',true,true)", id, "consent-"+id); err != nil {
			t.Fatal(err)
		}
	}
	consentRequired := func(id string) bool {
		res := rawRequest(t, app, id, http.MethodGet, "/api/v1/me", "")
		var me Me
		if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &me) != nil {
			t.Fatalf("me status=%d", res.Code)
		}
		return me.ConsentRequired
	}
	gated := []struct{ method, path, body string }{
		{http.MethodGet, "/api/v1/categories", ""},
		{http.MethodGet, "/api/v1/me/ballots", ""},
		{http.MethodGet, "/api/v1/me/email-reminders", ""},
		{http.MethodPut, "/api/v1/categories/" + pollID(1) + "/ballot", `{"option_ids":[]}`},
	}
	assertGated := func(id string) {
		t.Helper()
		for _, g := range gated {
			if res := rawRequest(t, app, id, g.method, g.path, g.body); res.Code != http.StatusForbidden || errorCode(res) != "consent_required" {
				t.Fatalf("%s %s without consent: status=%d code=%s", g.method, g.path, res.Code, errorCode(res))
			}
		}
	}

	// A new user can read the session and the consent text, nothing else.
	if !consentRequired(u) {
		t.Fatal("new user must be asked for consent")
	}
	res := rawRequest(t, app, u, http.MethodGet, "/api/v1/me/consent", "")
	var got Consent
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &got) != nil || got.Version != ConsentVersion || got.AcceptedAt != nil || len(got.Text) == 0 {
		t.Fatalf("consent text status=%d body=%s", res.Code, res.Body)
	}
	assertGated(u)
	var ballots int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballots WHERE user_id=$1", u).Scan(&ballots); err != nil || ballots != 0 {
		t.Fatalf("gated vote was stored: %d %v", ballots, err)
	}

	// Consent to an older text does not count, and a stale version cannot be accepted.
	if _, err := pool.Exec(ctx, "INSERT INTO consents(user_id,version) VALUES($1,'alt-version')", u); err != nil {
		t.Fatal(err)
	}
	assertGated(u)
	if res := rawRequest(t, app, u, http.MethodPost, "/api/v1/me/consent", `{"version":"alt-version"}`); res.Code != http.StatusConflict || errorCode(res) != "consent_outdated" {
		t.Fatalf("stale consent status=%d code=%s", res.Code, errorCode(res))
	}
	if !consentRequired(u) {
		t.Fatal("stale version must not satisfy consent")
	}

	// Accepting the current version unlocks only that user.
	res = rawRequest(t, app, u, http.MethodPost, "/api/v1/me/consent", `{"version":"`+ConsentVersion+`"}`)
	if res.Code != http.StatusOK || json.Unmarshal(res.Body.Bytes(), &got) != nil || got.AcceptedAt == nil {
		t.Fatalf("accept status=%d body=%s", res.Code, res.Body)
	}
	if consentRequired(u) {
		t.Fatal("consent not recorded")
	}
	if res := rawRequest(t, app, u, http.MethodGet, "/api/v1/categories", ""); res.Code != http.StatusOK {
		t.Fatalf("consented read status=%d", res.Code)
	}
	assertGated(v)
}

func TestLegalPages(t *testing.T) {
	dir := t.TempDir()
	app := &App{Config: Config{LegalDir: dir}}
	app.handler = http.NewServeMux()
	m := app.handler.(*http.ServeMux)
	for _, name := range legalPages {
		m.HandleFunc("GET /"+name, app.legalPage(name))
	}
	get := func(path string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		app.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		return res
	}
	if res := get("/impressum"); res.Code != http.StatusNotFound {
		t.Fatalf("missing page status=%d", res.Code)
	}
	if err := os.WriteFile(filepath.Join(dir, "impressum.html"), []byte("<h1>Impressum</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if res := get("/impressum"); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "Impressum") {
		t.Fatalf("page status=%d body=%s", res.Code, res.Body)
	}
	// Production must not start without both texts.
	prod := Config{Env: "production", DatabaseURL: "unused", PublicURL: "https://portal.example.org", AuthMode: "better_auth", AuthInternalURL: "http://auth:3000", AuthServiceSecret: strings.Repeat("a", 40), SessionSecret: strings.Repeat("s", 40), UploadDir: t.TempDir(), StaticDir: t.TempDir(), LegalDir: dir, Mail: MailConfig{Provider: "brevo", APIKey: "unused", From: "Portal <portal@example.org>", TrackingDisabled: true, DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150}}
	if _, err := New(context.Background(), prod, nil); err == nil || !strings.Contains(err.Error(), "LEGAL_DIR") {
		t.Fatalf("production without datenschutz.html: %v", err)
	}
}
