// Package authmock implements an isolated, development-only OIDC identity picker.
package authmock

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

type Config struct {
	Environment  string
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURIs []string
	Users        []User
}

type authorization struct {
	User      User
	Nonce     string
	Challenge string
	Redirect  string
	Expires   time.Time
}

type provider struct {
	config Config
	key    *rsa.PrivateKey
	signer jose.Signer
	mu     sync.Mutex
	codes  map[string]authorization
	now    func() time.Time
	mux    *http.ServeMux
}

// New refuses to create a provider outside an explicitly selected development environment.
func New(config Config) (http.Handler, error) {
	if config.Environment != "development" {
		return nil, errors.New("auth-mock requires APP_ENV=development")
	}
	config.Issuer = strings.TrimRight(config.Issuer, "/")
	issuer, err := url.Parse(config.Issuer)
	if err != nil || !validURL(issuer) || issuer.Path != "" || issuer.RawQuery != "" {
		return nil, errors.New("issuer must be an absolute HTTP(S) origin")
	}
	if !validText(config.ClientID, 255) || !validText(config.ClientSecret, 1024) || len(config.RedirectURIs) == 0 {
		return nil, errors.New("client credentials and redirect allowlist are required")
	}
	for _, redirect := range config.RedirectURIs {
		u, err := url.Parse(redirect)
		if err != nil || !validURL(u) {
			return nil, errors.New("invalid redirect allowlist")
		}
	}
	if err := validateUsers(config.Users); err != nil {
		return nil, err
	}
	config.Users = append([]User(nil), config.Users...)
	config.RedirectURIs = append([]string(nil), config.RedirectURIs...)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "development"}}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		return nil, err
	}
	p := &provider{config: config, key: key, signer: signer, codes: make(map[string]authorization), now: time.Now}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("GET /keys", p.keys)
	mux.HandleFunc("GET /authorize", p.authorize)
	mux.HandleFunc("POST /authorize", p.authorize)
	mux.HandleFunc("POST /token", p.token)
	p.mux = mux
	return p, nil
}

func (p *provider) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src "+pickerStyleHash+"; frame-ancestors 'none'; base-uri 'none'")
	p.mux.ServeHTTP(w, r)
}

func validURL(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.Fragment == "" && u.Opaque == ""
}

func (p *provider) discovery(w http.ResponseWriter, _ *http.Request) {
	i := p.config.Issuer
	jsonResponse(w, 200, map[string]any{
		"issuer": i, "authorization_endpoint": i + "/authorize", "token_endpoint": i + "/token", "jwks_uri": i + "/keys",
		"response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code"},
		"subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"code_challenge_methods_supported":      []string{"S256"}, "scopes_supported": []string{"openid", "profile"},
		"claims_supported": []string{"iss", "sub", "aud", "iat", "exp", "nonce", "name"},
	})
}

func (p *provider) keys(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &p.key.PublicKey, KeyID: "development", Algorithm: "RS256", Use: "sig"}}})
}

const pickerCSS = `
:root{color-scheme:light dark;--paper:#f5f6ec;--card:#fff;--ink:#15181f;--muted:#5d6270;--line:#d6dac0;--pop:#c8f23c;--accent:#d81e44}
@media (prefers-color-scheme:dark){:root{--paper:#15181f;--card:#1f242e;--ink:#f5f6ec;--muted:#a3a99a;--line:#363c4a}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 "Avenir Next","Segoe UI",system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 48px}
h1{margin:0 0 8px;font-size:clamp(1.6rem,6vw,2.2rem);font-weight:800;letter-spacing:-.025em;line-height:1.15}
.hint{margin:0 0 24px;color:var(--muted)}
.badge{display:inline-block;margin-bottom:12px;padding:2px 12px;border-radius:999px;background:var(--pop);color:#15181f;font-size:.8rem;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:12px}
.card{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border:2px solid var(--line);border-radius:16px;background:var(--card);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .12s,border-color .12s,box-shadow .12s}
.card:hover{border-color:var(--ink);transform:translateY(-2px);box-shadow:0 4px 0 var(--ink)}
.card:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.avatar{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--pop);color:#15181f;font-weight:800;font-size:1.2rem}
.text{min-width:0}
.name{display:block;font-weight:700;overflow-wrap:anywhere}
.slug{display:block;color:var(--muted);font-size:.8rem;overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
`

var pickerStyleHash = func() string {
	sum := sha256.Sum256([]byte(pickerCSS))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}()

var picker = template.Must(template.New("picker").Funcs(template.FuncMap{
	"initial": func(name string) string {
		for _, r := range name {
			return strings.ToUpper(string(r))
		}
		return "?"
	},
}).Parse(`<!doctype html>
<html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Entwicklungsanmeldung</title>
<style>` + pickerCSS + `</style>
<main><span class="badge">Nur Entwicklung</span><h1>Entwicklungsanmeldung</h1><p class="hint">Testidentität auswählen. Dies ist ein lokaler Mock-Anbieter ohne echte Konten.</p>
<form method="post" action="/authorize">{{range $key, $values := .Params}}{{range $values}}<input type="hidden" name="{{$key}}" value="{{.}}">{{end}}{{end}}
<div class="grid">{{range .Users}}<button class="card" type="submit" name="subject" value="{{.Subject}}"><span class="avatar" aria-hidden="true">{{initial .Name}}</span><span class="text"><span class="name">{{.Name}}</span><span class="slug">{{.DisplaySlug}}</span></span></button>{{end}}</div></form></main></html>`))

func (p *provider) authorize(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 16384)
		if err := r.ParseForm(); err != nil {
			oauthError(w, 400, "invalid_request")
			return
		}
		params = r.PostForm
	}
	if !p.validAuthorization(params) {
		oauthError(w, 400, "invalid_request")
		return
	}
	if r.Method == http.MethodGet {
		// Only validated protocol fields are carried into the picker form.
		fields := make(url.Values)
		for _, key := range []string{"client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method"} {
			fields.Set(key, params.Get(key))
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = picker.Execute(w, struct {
			Params url.Values
			Users  []User
		}{fields, p.config.Users})
		return
	}
	var selected *User
	for _, user := range p.config.Users {
		if user.Subject == params.Get("subject") && len(params["subject"]) == 1 {
			selected = &user
			break
		}
	}
	if selected == nil {
		oauthError(w, 400, "invalid_request")
		return
	}
	code := randomToken()
	now := p.now()
	p.mu.Lock()
	for code, authorization := range p.codes {
		if !now.Before(authorization.Expires) {
			delete(p.codes, code)
		}
	}
	if len(p.codes) >= 1024 {
		p.mu.Unlock()
		oauthError(w, 503, "temporarily_unavailable")
		return
	}
	p.codes[code] = authorization{*selected, params.Get("nonce"), params.Get("code_challenge"), params.Get("redirect_uri"), now.Add(time.Minute)}
	p.mu.Unlock()
	redirect, _ := url.Parse(params.Get("redirect_uri"))
	query := redirect.Query()
	query.Set("code", code)
	query.Set("state", params.Get("state"))
	redirect.RawQuery = query.Encode()
	http.Redirect(w, r, redirect.String(), http.StatusSeeOther)
}

func (p *provider) validAuthorization(q url.Values) bool {
	for _, name := range []string{"client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method"} {
		if len(q[name]) != 1 || !validText(q.Get(name), 2048) {
			return false
		}
	}
	if q.Get("client_id") != p.config.ClientID || q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" {
		return false
	}
	challenge, err := base64.RawURLEncoding.DecodeString(q.Get("code_challenge"))
	if err != nil || len(challenge) != sha256.Size {
		return false
	}
	if !strings.Contains(" "+q.Get("scope")+" ", " openid ") {
		return false
	}
	for _, redirect := range p.config.RedirectURIs {
		if q.Get("redirect_uri") == redirect {
			return true
		}
	}
	return false
}

func (p *provider) token(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	if err := r.ParseForm(); err != nil {
		oauthError(w, 400, "invalid_request")
		return
	}
	f := r.PostForm
	for _, values := range f {
		if len(values) != 1 {
			oauthError(w, 400, "invalid_request")
			return
		}
	}
	id, secret, basic := r.BasicAuth()
	if basic {
		// OAuth2 HTTP Basic credentials are application/x-www-form-urlencoded.
		var err error
		id, err = url.QueryUnescape(id)
		if err != nil {
			oauthError(w, 401, "invalid_client")
			return
		}
		secret, err = url.QueryUnescape(secret)
		if err != nil {
			oauthError(w, 401, "invalid_client")
			return
		}
		if f.Has("client_id") || f.Has("client_secret") {
			oauthError(w, 401, "invalid_client")
			return
		}
	} else {
		id, secret = f.Get("client_id"), f.Get("client_secret")
	}
	if subtle.ConstantTimeCompare([]byte(id), []byte(p.config.ClientID)) != 1 || subtle.ConstantTimeCompare([]byte(secret), []byte(p.config.ClientSecret)) != 1 {
		w.Header().Set("WWW-Authenticate", `Basic realm="auth-mock"`)
		oauthError(w, 401, "invalid_client")
		return
	}
	if f.Get("grant_type") != "authorization_code" {
		oauthError(w, 400, "unsupported_grant_type")
		return
	}
	p.mu.Lock()
	code, ok := p.codes[f.Get("code")]
	delete(p.codes, f.Get("code"))
	p.mu.Unlock()
	verifier := f.Get("code_verifier")
	hash := sha256.Sum256([]byte(verifier))
	if !ok || !p.now().Before(code.Expires) || f.Get("redirect_uri") != code.Redirect || !validVerifier(verifier) || subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(hash[:])), []byte(code.Challenge)) != 1 {
		oauthError(w, 400, "invalid_grant")
		return
	}
	now := p.now()
	claims := map[string]any{"iss": p.config.Issuer, "sub": code.User.Subject, "aud": p.config.ClientID, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "name": code.User.Name, "nonce": code.Nonce}
	idToken, err := p.sign(claims)
	if err != nil {
		oauthError(w, 500, "server_error")
		return
	}
	delete(claims, "nonce")
	claims["token_use"] = "access"
	accessToken, err := p.sign(claims)
	if err != nil {
		oauthError(w, 500, "server_error")
		return
	}
	jsonResponse(w, 200, map[string]any{"access_token": accessToken, "token_type": "Bearer", "expires_in": 300, "id_token": idToken})
}

func validVerifier(verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	return strings.IndexFunc(verifier, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("-._~", r))
	}) < 0
}

func (p *provider) sign(claims map[string]any) (string, error) {
	data, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signed, err := p.signer.Sign(data)
	if err != nil {
		return "", err
	}
	return signed.CompactSerialize()
}

func randomToken() string {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		panic("cryptographic randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(token[:])
}

func oauthError(w http.ResponseWriter, status int, code string) {
	jsonResponse(w, status, map[string]string{"error": code})
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
