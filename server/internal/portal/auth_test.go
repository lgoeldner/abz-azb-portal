package portal

import (
	"abizeitbetrug/server/internal/authmock"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/go-jose/go-jose/v4"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func mockProvider(t *testing.T, issuer, portal string, users []authmock.User) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(nil)
	t.Cleanup(server.Close)
	if issuer == "" {
		issuer = server.URL
	}
	handler, err := authmock.New(authmock.Config{Environment: "development", Issuer: issuer, ClientID: "portal-dev", ClientSecret: "dev-only", RedirectURIs: []string{portal + "/auth/callback"}, Users: users})
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = handler
	return server
}

func TestExternalOIDCTrustAndEnrollment(t *testing.T) {
	for _, scenario := range []string{"seeded", "unknown", "signature", "nonce", "issuer", "audience", "expiry"} {
		t.Run(scenario, func(t *testing.T) {
			pool := integrationPool(t)
			server := httptest.NewUnstartedServer(nil)
			publicURL := "http://" + server.Listener.Addr().String()
			// Backchannel must cover discovery, token and JWKS without changing issuer claims.
			canonical := "http://provider.invalid:9090"
			provider := mockProvider(t, canonical, publicURL, []authmock.User{{Subject: MiaID, Name: "Mia"}, {Subject: "new-yaml-subject", Name: "New member"}})
			handler := provider.Config.Handler
			// Re-sign deliberately invalid claims using a separately trusted fixture key.
			// The signature case publishes this key but signs with the original provider key.
			if scenario != "seeded" {
				key, err := rsa.GenerateKey(rand.Reader, 2048)
				if err != nil {
					t.Fatal(err)
				}
				provider.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/keys" {
						jsonOut(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "development", Algorithm: "RS256", Use: "sig"}}})
						return
					}
					if r.URL.Path != "/token" || scenario == "signature" {
						handler.ServeHTTP(w, r)
						return
					}
					rec := httptest.NewRecorder()
					handler.ServeHTTP(rec, r)
					var response map[string]any
					json.Unmarshal(rec.Body.Bytes(), &response)
					original, err := jose.ParseSigned(response["id_token"].(string), []jose.SignatureAlgorithm{jose.RS256})
					if err != nil {
						t.Fatal(err)
					}
					var claims map[string]any
					json.Unmarshal(original.UnsafePayloadWithoutVerification(), &claims)
					switch scenario {
					case "nonce":
						claims["nonce"] = "wrong"
					case "issuer":
						claims["iss"] = "https://other.example"
					case "audience":
						claims["aud"] = "other-client"
					case "expiry":
						claims["exp"] = time.Now().Add(-time.Minute).Unix()
					}
					claims["role"] = "admin"
					claims["admitted"] = true
					signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "development"}}, nil)
					payload, _ := json.Marshal(claims)
					signed, _ := signer.Sign(payload)
					response["id_token"], _ = signed.CompactSerialize()
					jsonOut(w, 200, response)
				})
			}
			if err := SeedWithIssuer(context.Background(), pool, "development", canonical); err != nil {
				t.Fatal(err)
			}
			cfg := Config{Env: "development", DatabaseURL: "unused", PublicURL: publicURL, UploadDir: t.TempDir(), StaticDir: t.TempDir(), AuthMode: "mock", Issuer: canonical, BackchannelURL: provider.URL, ClientID: "portal-dev", ClientSecret: "dev-only", SessionSecret: strings.Repeat("s", 32), BootstrapSubject: "new-yaml-subject"}
			app, err := New(context.Background(), cfg, pool)
			if err != nil {
				t.Fatal(err)
			}
			server.Config.Handler = app
			server.Start()
			defer server.Close()
			jar, _ := cookiejar.New(nil)
			client := &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
			res, err := client.Get(server.URL + "/auth/login?user=ignored")
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			authorization, err := url.Parse(res.Header.Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			if authorization.Host != "provider.invalid:9090" {
				t.Fatal("backchannel changed browser authorization origin")
			}
			// Browser opens the provider and submits its identity picker.
			target := provider.URL + authorization.RequestURI()
			res, err = client.Get(target)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Fatalf("picker status %d", res.StatusCode)
			}
			form := authorization.Query()
			subject := MiaID
			if scenario == "unknown" {
				subject = "new-yaml-subject"
			}
			form.Set("subject", subject)
			res, err = client.PostForm(provider.URL+"/authorize", form)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			callback := res.Header.Get("Location")
			res, err = client.Get(callback)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if scenario != "seeded" && scenario != "unknown" {
				if res.StatusCode != 401 {
					t.Fatalf("invalid identity accepted: %d %s", res.StatusCode, body)
				}
				var count int
				pool.QueryRow(context.Background(), "SELECT count(*) FROM sessions").Scan(&count)
				if count != 0 {
					t.Fatal("invalid identity created session")
				}
				return
			}
			if res.StatusCode != 302 || res.Header.Get("Location") != "/" {
				t.Fatalf("callback: %d %s", res.StatusCode, body)
			}
			res, err = client.Get(server.URL + "/api/v1/me")
			if err != nil {
				t.Fatal(err)
			}
			body, _ = io.ReadAll(res.Body)
			res.Body.Close()
			var me struct {
				User User   `json:"user"`
				CSRF string `json:"csrf_token"`
			}
			if err = json.Unmarshal(body, &me); err != nil {
				t.Fatal(err)
			}
			pending := scenario == "unknown"
			if me.User.Role != "student" || me.User.Admitted == pending || me.CSRF == "" {
				t.Fatalf("unexpected local permissions: %+v", me.User)
			}
			if !pending && me.User.ID != MiaID {
				t.Fatal("seed identity changed")
			}
			if strings.Contains(string(body), "id_token") || strings.Contains(string(body), "access_token") {
				t.Fatal("provider token leaked")
			}
			u, _ := url.Parse(server.URL)
			for _, c := range jar.Cookies(u) {
				if c.Name == "portal_session" && (len(c.Value) != 43 || strings.Contains(c.Value, ".")) {
					t.Fatal("session contains provider JWT")
				}
			}
			// Replayed codes and invalid state cannot establish another session.
			res, err = client.Get(callback)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 400 {
				t.Fatal("callback replay accepted")
			}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("GET", "/auth/callback?state=wrong", nil)
			req.AddCookie(&http.Cookie{Name: "portal_login", Value: app.signState(loginState{State: "expected", Expires: time.Now().Add(time.Minute).Unix()})})
			app.ServeHTTP(rec, req)
			if rec.Code != 400 {
				t.Fatal("invalid state accepted")
			}
			for _, path := range []string{"/auth/mock/users", "/dev/oidc/keys", "/dev/oidc/.well-known/openid-configuration"} {
				r, e := client.Get(server.URL + path)
				if e != nil {
					t.Fatal(e)
				}
				r.Body.Close()
				if r.StatusCode != 404 {
					t.Fatalf("embedded endpoint remains: %s %d", path, r.StatusCode)
				}
			}
		})
	}
}

func TestBackchannelConfigGuards(t *testing.T) {
	cfg := Config{Env: "development", DatabaseURL: "unused", PublicURL: "http://localhost:8080", AuthMode: "mock", Issuer: "http://localhost:9090", ClientID: "portal-dev", ClientSecret: "dev-only"}
	for _, v := range []string{"http://user:password@localhost:9090", "http://localhost:9090/path", "http://localhost:9090?query=x", "http://localhost:9090#fragment", "file:///tmp/socket"} {
		cfg.BackchannelURL = v
		if cfg.Validate() == nil {
			t.Errorf("invalid backchannel accepted: %s", v)
		}
	}
	cfg.BackchannelURL = "http://auth-mock:9090"
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg.AuthMode = "oidc"
	if cfg.Validate() == nil {
		t.Fatal("oidc mode accepted backchannel")
	}
	cfg.Env = "production"
	cfg.Issuer = "https://issuer.example"
	cfg.PublicURL = "https://portal.example"
	cfg.SessionSecret = strings.Repeat("s", 32)
	cfg.UploadDir = t.TempDir()
	cfg.StaticDir = t.TempDir()
	if cfg.Validate() == nil {
		t.Fatal("production accepted backchannel")
	}
}

func TestSeedMigratesOnlyLegacyFixtureSubjects(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := SeedWithIssuer(ctx, pool, "development", "http://old.example/dev/oidc"); err != nil {
		t.Fatal(err)
	}
	// Keep role/admission/content local while rebinding only recognized old mocks.
	if _, err := pool.Exec(ctx, "UPDATE users SET subject='mock:legacy',role='manager',admitted=false,name='Edited locally' WHERE id=$1", MiaID); err != nil {
		t.Fatal(err)
	}
	realSubject := "https://real.example/tenant\x1f" + LeonID
	if _, err := pool.Exec(ctx, "UPDATE users SET subject=$2 WHERE id=$1", LeonID, realSubject); err != nil {
		t.Fatal(err)
	}
	if err := SeedWithIssuer(ctx, pool, "development", "http://localhost:9090"); err != nil {
		t.Fatal(err)
	}
	var subject, role, name string
	var admitted bool
	if err := pool.QueryRow(ctx, "SELECT subject,role,name,admitted FROM users WHERE id=$1", MiaID).Scan(&subject, &role, &name, &admitted); err != nil {
		t.Fatal(err)
	}
	if subject != "http://localhost:9090\x1f"+MiaID || role != "manager" || admitted || name != "Edited locally" {
		t.Fatal("legacy migration replaced local state")
	}
	if err := pool.QueryRow(ctx, "SELECT subject FROM users WHERE id=$1", LeonID).Scan(&subject); err != nil {
		t.Fatal(err)
	}
	if subject != realSubject {
		t.Fatal("seed rebound an arbitrary OIDC provider identity")
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM submissions WHERE author_id=$1", MiaID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("seed migration lost or duplicated content")
	}
	if err := pool.QueryRow(ctx, "SELECT subject FROM users WHERE id=$1", ManagerID).Scan(&subject); err != nil {
		t.Fatal(err)
	}
	if subject != "http://localhost:9090\x1f"+ManagerID {
		t.Fatal("legacy embedded issuer was not migrated")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBackchannelRewritesOnlyCanonicalOrigin(t *testing.T) {
	canonical, _ := url.Parse("http://issuer.example:9090")
	backchannel, _ := url.Parse("http://auth-mock:9090")
	for _, tc := range []struct{ input, want string }{
		{"http://issuer.example:9090/token?x=1", "http://auth-mock:9090/token?x=1"},
		{"https://issuer.example:9090/keys", "https://issuer.example:9090/keys"},
		{"http://issuer.example/keys", "http://issuer.example/keys"},
		{"http://other.example:9090/keys", "http://other.example:9090/keys"},
	} {
		original := httptest.NewRequest("GET", tc.input, nil)
		transport := issuerTransport{canonical, backchannel, transportFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.String() != tc.want {
				t.Fatalf("rewrite: %s => %s want %s", tc.input, r.URL, tc.want)
			}
			return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
		})}
		if _, err := transport.RoundTrip(original); err != nil {
			t.Fatal(err)
		}
		if original.URL.String() != tc.input {
			t.Fatal("transport mutated original request")
		}
	}
}

func TestDevelopmentConfigDefaults(t *testing.T) {
	for _, key := range []string{"OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_BACKCHANNEL_URL"} {
		t.Setenv(key, "")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("AUTH_MODE", "mock")
	t.Setenv("DATABASE_URL", "unused")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Issuer != "http://localhost:9090" || cfg.ClientID != "portal-dev" || cfg.ClientSecret != "dev-only" {
		t.Fatal("missing standalone mock defaults")
	}
}
