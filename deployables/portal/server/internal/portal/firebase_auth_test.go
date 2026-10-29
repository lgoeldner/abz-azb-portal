package portal

import (
	"abizeitbetrug/auth-mock/authmock"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// hostingCookieStripper models Firebase Hosting's request behavior for the
// portal origin: only the reserved __session cookie reaches the backend.
type hostingCookieStripper struct {
	portalHost string
	base       http.RoundTripper
}

func firstCookieName(cookies []*http.Cookie) string {
	if len(cookies) == 0 {
		return ""
	}
	return cookies[0].Name
}

func cookieNameList(cookies []*http.Cookie) []string {
	names := make([]string, len(cookies))
	for i, cookie := range cookies {
		names[i] = cookie.Name
	}
	return names
}

func (s hostingCookieStripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Host == s.portalHost {
		var session *http.Cookie
		for _, cookie := range req.Cookies() {
			if cookie.Name == "__session" {
				session = cookie
				break
			}
		}
		req = req.Clone(req.Context())
		req.Header.Del("Cookie")
		if session != nil {
			req.AddCookie(session)
		}
	}
	return s.base.RoundTrip(req)
}

func TestFirebaseHostingOIDCSessionCookie(t *testing.T) {
	pool := integrationPool(t)
	server := httptest.NewUnstartedServer(nil)
	publicURL := "http://" + server.Listener.Addr().String()
	canonical := "http://provider.invalid:9090"
	provider := mockProvider(t, canonical, publicURL, []authmock.User{{Subject: FixtureSubject(MiaID), Name: "Mia", DisplaySlug: "mia_weber"}})
	if err := SeedWithIssuer(context.Background(), pool, "development", canonical); err != nil {
		t.Fatal(err)
	}
	cfg := Config{Env: "development", DatabaseURL: "unused", PublicURL: publicURL, UploadDir: t.TempDir(), StaticDir: t.TempDir(), AuthMode: "mock", Issuer: canonical, BackchannelURL: provider.URL, ClientID: "portal-dev", ClientSecret: "dev-only", SessionSecret: strings.Repeat("s", 32), FirebaseHosting: true}
	app, err := New(context.Background(), cfg, pool)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = app
	server.Start()
	defer server.Close()

	portalURL, _ := url.Parse(server.URL)
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	transport := hostingCookieStripper{portalHost: portalURL.Host, base: http.DefaultTransport}
	client := &http.Client{Jar: jar, Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	portalClient := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	assertPortalCookie := func(want string) *http.Cookie {
		t.Helper()
		cookies := jar.Cookies(portalURL)
		if len(cookies) != 1 || cookies[0].Name != "__session" {
			t.Fatalf("portal has cookies other than the single Hosting cookie: count=%d names=%v", len(cookies), cookieNameList(cookies))
		}
		if want != "" && cookies[0].Value != want {
			t.Fatalf("unexpected __session value")
		}
		return cookies[0]
	}
	checkNoStore := func(res *http.Response) {
		t.Helper()
		if res.Header.Get("Cache-Control") != "no-store" {
			t.Errorf("%s %s lacked no-store: %q", res.Request.Method, res.Request.URL.Path, res.Header.Get("Cache-Control"))
		}
	}
	readAndClose := func(res *http.Response) []byte {
		t.Helper()
		body, readErr := io.ReadAll(res.Body)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr := res.Body.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
		return body
	}

	res, err := client.Get(server.URL + "/auth/login")
	if err != nil {
		t.Fatal(err)
	}
	checkNoStore(res)
	if res.StatusCode != http.StatusFound {
		t.Fatalf("login status %d", res.StatusCode)
	}
	loginLocation := res.Header.Get("Location")
	if got := res.Cookies(); len(got) != 1 || got[0].Name != "__session" {
		t.Fatalf("login did not use the single Hosting cookie: count=%d names=%v", len(got), cookieNameList(got))
	}
	readAndClose(res)
	stateCookie := assertPortalCookie("")
	stateValue := stateCookie.Value
	if !strings.Contains(stateValue, ".") {
		t.Fatal("transient login state was not signed")
	}

	// A signed state cookie must never be accepted as an authenticated session.
	res, err = client.Get(server.URL + "/api/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("transient state authenticated /me: %d", res.StatusCode)
	}
	readAndClose(res)

	// Missing and tampered callback state return no-store errors and do not
	// emit a cookie that could overwrite another shared __session value.
	invalidStates := []struct{ name, cookieValue string }{
		{name: "missing"},
		{name: "tampered", cookieValue: stateValue + "x"},
		{name: "mismatched-query", cookieValue: stateValue},
		{name: "expired", cookieValue: app.signState(loginState{State: "expired", Expires: time.Now().Add(-time.Minute).Unix()})},
	}
	for _, test := range invalidStates {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/auth/callback?state=wrong", nil)
		if test.cookieValue != "" {
			req.AddCookie(&http.Cookie{Name: "__session", Value: test.cookieValue})
		}
		bad, requestErr := portalClient.Do(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		checkNoStore(bad)
		if bad.StatusCode != http.StatusBadRequest || len(bad.Cookies()) != 0 {
			t.Fatalf("%s callback state was accepted or changed cookies: status=%d cookie_names=%v", test.name, bad.StatusCode, cookieNameList(bad.Cookies()))
		}
		readAndClose(bad)
	}
	assertPortalCookie(stateValue)

	authorization, err := url.Parse(loginLocation)
	if err != nil {
		t.Fatal(err)
	}
	if authorization.Host != "provider.invalid:9090" {
		t.Fatalf("browser authorization origin changed: %s", authorization.Host)
	}
	providerURL := provider.URL + authorization.RequestURI()
	res, err = client.Get(providerURL)
	if err != nil {
		t.Fatal(err)
	}
	readAndClose(res)
	form := authorization.Query()
	form.Set("subject", FixtureSubject(MiaID))
	res, err = client.PostForm(provider.URL+"/authorize", form)
	if err != nil {
		t.Fatal(err)
	}
	callbackURL := res.Header.Get("Location")
	readAndClose(res)
	if callbackURL == "" {
		t.Fatal("provider did not return an OIDC callback")
	}
	res, err = client.Get(callbackURL)
	if err != nil {
		t.Fatal(err)
	}
	checkNoStore(res)
	if res.StatusCode != http.StatusFound || res.Header.Get("Location") != "/" {
		t.Fatalf("callback failed: %d %s", res.StatusCode, readAndClose(res))
	}
	var clearedState, issuedSession bool
	for _, cookie := range res.Cookies() {
		clearedState = clearedState || cookie.Name == "__session" && cookie.MaxAge < 0
		issuedSession = issuedSession || cookie.Name == "__session" && len(cookie.Value) == 43 && !strings.Contains(cookie.Value, ".")
	}
	readAndClose(res)
	if !clearedState || !issuedSession {
		t.Fatal("callback did not replace transient state with an opaque shared session")
	}
	sessionCookie := assertPortalCookie("")
	if sessionCookie.Value == stateValue || strings.Contains(sessionCookie.Value, ".") || len(sessionCookie.Value) != 43 {
		t.Fatal("Hosting cookie is not an opaque portal session")
	}
	assertSessionRows := func(want int) {
		t.Helper()
		var got int
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM sessions").Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("session row count %d, want %d", got, want)
		}
	}
	assertSessionRows(1)

	res, err = client.Get(server.URL + "/api/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("authenticated /me failed: %d %s", res.StatusCode, readAndClose(res))
	}
	var me struct {
		User User   `json:"user"`
		CSRF string `json:"csrf_token"`
	}
	if err := json.Unmarshal(readAndClose(res), &me); err != nil {
		t.Fatal(err)
	}
	if me.User.ID != MiaID || me.CSRF == "" {
		t.Fatalf("unexpected /me result: user=%+v csrf missing=%t", me.User, me.CSRF == "")
	}

	// Invalid and replayed callbacks must not clear an established shared
	// session, even though the callback parser sees that same cookie name.
	for name, callback := range map[string]string{"replay": callbackURL, "invalid": server.URL + "/auth/callback?state=wrong"} {
		req, _ := http.NewRequest(http.MethodGet, callback, nil)
		req.AddCookie(sessionCookie)
		bad, requestErr := portalClient.Do(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		checkNoStore(bad)
		if bad.StatusCode != http.StatusBadRequest || len(bad.Cookies()) != 0 {
			t.Fatalf("%s callback changed an established session: status=%d cookie_names=%v", name, bad.StatusCode, cookieNameList(bad.Cookies()))
		}
		readAndClose(bad)
	}
	assertPortalCookie(sessionCookie.Value)

	res, err = client.Post(server.URL+"/auth/logout", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	checkNoStore(res)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("logout without CSRF token returned %d", res.StatusCode)
	}
	readAndClose(res)
	assertPortalCookie(sessionCookie.Value)
	assertSessionRows(1)

	logoutReq, _ := http.NewRequest(http.MethodPost, server.URL+"/auth/logout", strings.NewReader(`{}`))
	logoutReq.Header.Set("X-CSRF-Token", me.CSRF)
	res, err = client.Do(logoutReq)
	if err != nil {
		t.Fatal(err)
	}
	checkNoStore(res)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("logout failed: %d %s", res.StatusCode, readAndClose(res))
	}
	if got := res.Cookies(); len(got) != 1 || got[0].Name != "__session" || got[0].MaxAge >= 0 {
		t.Fatalf("logout did not expire the shared session cookie: count=%d names=%v", len(got), cookieNameList(got))
	}
	readAndClose(res)
	if got := jar.Cookies(portalURL); len(got) != 0 {
		t.Fatalf("logout retained a browser session cookie: names=%v", cookieNameList(got))
	}
	assertSessionRows(0)
	res, err = client.Get(server.URL + "/api/v1/me")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("logout left /me authenticated: %d", res.StatusCode)
	}
	readAndClose(res)

	res, err = client.Get(server.URL + "/auth/unknown")
	if err != nil {
		t.Fatal(err)
	}
	checkNoStore(res)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown auth route status %d", res.StatusCode)
	}
	readAndClose(res)
}
