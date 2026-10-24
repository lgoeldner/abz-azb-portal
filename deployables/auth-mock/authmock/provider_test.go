package authmock

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

func testProvider(t *testing.T) (*provider, *httptest.Server, Config) {
	t.Helper()
	server := httptest.NewUnstartedServer(nil)
	config := Config{Environment: "development", Issuer: "http://" + server.Listener.Addr().String(), ClientID: "portal-dev", ClientSecret: "dev-only", RedirectURIs: []string{"http://localhost:8080/auth/callback"}, Users: []User{{Subject: SubjectForSlug("mia_weber"), Name: "Mia Weber", DisplaySlug: "mia_weber"}, {Subject: SubjectForSlug("leon_fischer"), Name: "Leon Fischer", DisplaySlug: "leon_fischer"}}}
	handler, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = handler
	server.Start()
	t.Cleanup(server.Close)
	return handler.(*provider), server, config
}

func authParams(config Config) url.Values {
	hash := sha256.Sum256([]byte(strings.Repeat("a", 43)))
	return url.Values{"client_id": {config.ClientID}, "redirect_uri": {config.RedirectURIs[0]}, "response_type": {"code"}, "scope": {"openid profile"}, "state": {"test-state"}, "nonce": {"test-nonce"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}, "code_challenge_method": {"S256"}}
}

func request(t *testing.T, handler http.Handler, method, target string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req := httptest.NewRequest(method, target, body)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func authorizeCode(t *testing.T, p *provider, config Config) string {
	t.Helper()
	params := authParams(config)
	params.Set("subject", config.Users[0].Subject)
	w := request(t, p, "POST", "/authorize", params)
	if w.Code != http.StatusSeeOther {
		t.Fatalf("authorize: %d %s", w.Code, w.Body.String())
	}
	redirect, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if redirect.Query().Get("state") != params.Get("state") || redirect.Query().Get("code") == "" {
		t.Fatal("missing state or authorization code")
	}
	return redirect.Query().Get("code")
}

func tokenForm(config Config, code string) url.Values {
	return url.Values{"client_id": {config.ClientID}, "client_secret": {config.ClientSecret}, "grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {config.RedirectURIs[0]}, "code_verifier": {strings.Repeat("a", 43)}}
}

func TestOIDCDiscoveryIdentityPickerAndSignedTokens(t *testing.T) {
	p, server, config := testProvider(t)
	discovery, err := oidc.NewProvider(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	page := request(t, p, "GET", "/authorize?"+authParams(config).Encode(), nil)
	if page.Code != 200 {
		t.Fatalf("picker: %d", page.Code)
	}
	for _, user := range config.Users {
		body := page.Body.String()
		if !strings.Contains(body, `<button class="card" type="submit" name="subject" value="`+user.Subject+`"`) || !strings.Contains(body, user.Name) || !strings.Contains(body, user.DisplaySlug) {
			t.Fatalf("missing identity %s", user.Name)
		}
	}
	// Inline style is allowed by hash only; scripts and other sources stay blocked.
	csp := page.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "style-src "+pickerStyleHash) || strings.Contains(csp, "unsafe-inline") || strings.Contains(csp, "script-src") || !strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("unexpected CSP %q", csp)
	}
	if strings.Contains(page.Body.String(), "role") {
		t.Fatal("picker exposes role data")
	}
	code := authorizeCode(t, p, config)
	w := request(t, p, "POST", "/token", tokenForm(config, code))
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("token response: %d %s", w.Code, w.Body.String())
	}
	var tokens struct {
		IDToken     string `json:"id_token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &tokens); err != nil {
		t.Fatal(err)
	}
	verifier := discovery.Verifier(&oidc.Config{ClientID: config.ClientID})
	id, err := verifier.Verify(context.Background(), tokens.IDToken)
	if err != nil {
		t.Fatal(err)
	}
	if id.Subject != config.Users[0].Subject || id.Nonce != "test-nonce" {
		t.Fatal("identity or nonce mismatch")
	}
	var claims map[string]any
	if err := id.Claims(&claims); err != nil {
		t.Fatal(err)
	}
	if claims["name"] != config.Users[0].Name || claims["role"] != nil {
		t.Fatal("identity claim or local permission boundary violated")
	}
	if _, err := verifier.Verify(context.Background(), tokens.AccessToken); err != nil {
		t.Fatalf("access token is not a valid signed JWT: %v", err)
	}
	if got := request(t, p, "POST", "/token", tokenForm(config, code)); got.Code != 400 {
		t.Fatal("authorization code replay accepted")
	}
}

func TestAuthorizationRejectsUnsafeInputsWithoutRedirect(t *testing.T) {
	p, _, config := testProvider(t)
	cases := map[string]func(url.Values){
		"redirect":          func(q url.Values) { q.Set("redirect_uri", "https://attacker.invalid/auth/callback") },
		"redirect suffix":   func(q url.Values) { q.Set("redirect_uri", config.RedirectURIs[0]+"/extra") },
		"client":            func(q url.Values) { q.Set("client_id", "other") },
		"nonce":             func(q url.Values) { q.Del("nonce") },
		"state":             func(q url.Values) { q.Del("state") },
		"plain PKCE":        func(q url.Values) { q.Set("code_challenge_method", "plain") },
		"invalid challenge": func(q url.Values) { q.Set("code_challenge", "short") },
		"duplicate":         func(q url.Values) { q.Add("redirect_uri", config.RedirectURIs[0]) },
		"scope":             func(q url.Values) { q.Set("scope", "profile") },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			q := authParams(config)
			change(q)
			for _, method := range []string{"GET", "POST"} {
				target := "/authorize"
				var form url.Values
				if method == "GET" {
					target += "?" + q.Encode()
				} else {
					form = q
					form.Set("subject", config.Users[0].Subject)
				}
				w := request(t, p, method, target, form)
				if w.Code != 400 || w.Header().Get("Location") != "" {
					t.Fatal("unsafe authorize request accepted or redirected")
				}
			}
		})
	}
	q := authParams(config)
	q.Set("subject", "unknown")
	if w := request(t, p, "POST", "/authorize", q); w.Code != 400 {
		t.Fatal("unknown identity accepted")
	}
}

func TestTokenBindingExpiryAndClientAuthentication(t *testing.T) {
	p, _, config := testProvider(t)
	for _, field := range []string{"client_secret", "client_id", "redirect_uri", "code_verifier"} {
		t.Run(field, func(t *testing.T) {
			code := authorizeCode(t, p, config)
			form := tokenForm(config, code)
			form.Set(field, "wrong")
			w := request(t, p, "POST", "/token", form)
			if w.Code < 400 {
				t.Fatal("invalid token request accepted")
			}
			if field == "redirect_uri" || field == "code_verifier" {
				if request(t, p, "POST", "/token", tokenForm(config, code)).Code != 400 {
					t.Fatal("failed grant was reusable")
				}
			}
		})
	}
	code := authorizeCode(t, p, config)
	p.now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	if request(t, p, "POST", "/token", tokenForm(config, code)).Code != 400 {
		t.Fatal("expired code accepted")
	}
	p.now = time.Now
	code = authorizeCode(t, p, config)
	form := tokenForm(config, code)
	form.Del("client_id")
	form.Del("client_secret")
	req := httptest.NewRequest("POST", "/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(config.ClientID, config.ClientSecret)
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("valid basic client auth failed: %d", w.Code)
	}
}

func TestProviderDevelopmentIsolation(t *testing.T) {
	_, _, config := testProvider(t)
	for _, environment := range []string{"", "production", "test", "Development"} {
		config.Environment = environment
		if _, err := New(config); err == nil {
			t.Fatalf("provider started in %q", environment)
		}
	}
}

func TestLoadUsersStrictConfigurationAndFixtures(t *testing.T) {
	file, err := os.Open("../../../deployables/auth-mock/users.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	users, err := LoadUsers(file)
	// Which identities exist is checked against seeded accounts in portal; here the fixture only has to load.
	if err != nil || len(users) == 0 {
		t.Fatalf("fixture identities: %d %v", len(users), err)
	}
	for _, input := range []string{
		"users: []", "users: [",
		"users:\n - subject: a\n   name: Test\n   display_slug: a", // legacy typed subject
		"users:\n - name: Test\n   display_slug: a\n   role: admin",
		"users:\n - name: Test\n   display_slug: a\n - name: Duplicate\n   display_slug: a",
		"users:\n - name: Test", "users:\n - name: Test\n   display_slug: ''",
		"users:\n - name: Test\n   display_slug: Upper", "users:\n - name: Test\n   display_slug: has-dash",
		"users:\n - name: Test\n   display_slug: " + strings.Repeat("a", 65),
		"users:\n - name: ''\n   display_slug: a",
		"users:\n - name: Test\n   display_slug: a\n---\nusers: []", "users: []\nunknown: true", "users: []\nusers: []",
	} {
		if _, err := LoadUsers(strings.NewReader(input)); err == nil {
			t.Fatalf("invalid identity YAML accepted: %q", input)
		}
	}
}

func TestSubjectsAreStableAndDistinctPerSlug(t *testing.T) {
	const input = "users:\n - name: A\n   display_slug: marius_funke\n - name: B\n   display_slug: alex_admin\n"
	first, err := LoadUsers(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadUsers(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if first[0].Subject != second[0].Subject || first[1].Subject != second[1].Subject {
		t.Fatal("subject changed between loads")
	}
	if first[0].Subject == first[1].Subject || first[0].Subject == "" {
		t.Fatal("different slugs share a subject")
	}
	// Renaming a user must not change the subject; the slug alone identifies it.
	renamed, err := LoadUsers(strings.NewReader("users:\n - name: Renamed\n   display_slug: marius_funke\n"))
	if err != nil || renamed[0].Subject != first[0].Subject {
		t.Fatal("subject depends on display name")
	}
	if got := first[0].Subject; len(got) != 36 || got[14] != '5' || !strings.ContainsRune("89ab", rune(got[19])) {
		t.Fatalf("not a UUIDv5: %q", got)
	}
}
