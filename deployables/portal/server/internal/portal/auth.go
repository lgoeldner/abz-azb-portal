package portal

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type loginState struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Expires  int64  `json:"expires"`
}
type authState struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	secret   []byte
	issuer   string
	client   *http.Client
}

// Rewrite only the canonical issuer origin; issuer and JWT claims stay canonical.
type issuerTransport struct {
	canonical, backchannel *url.URL
	base                   http.RoundTripper
}

func (t issuerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme == t.canonical.Scheme && r.URL.Host == t.canonical.Host {
		r = r.Clone(r.Context())
		u := *r.URL
		u.Scheme, u.Host = t.backchannel.Scheme, t.backchannel.Host
		r.URL = &u
		r.Host = ""
	}
	return t.base.RoundTrip(r)
}

func randomToken() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func (a *App) setupAuth(ctx context.Context) error {
	c := a.Config
	auth := &authState{secret: []byte(c.SessionSecret), client: &http.Client{Timeout: 15 * time.Second}}
	if len(auth.secret) == 0 {
		auth.secret = []byte(randomToken())
	}
	if c.BackchannelURL != "" {
		canonical, _ := url.Parse(c.Issuer)
		backchannel, _ := url.Parse(c.BackchannelURL)
		auth.client.Transport = issuerTransport{canonical, backchannel, http.DefaultTransport}
	}
	a.auth = auth
	auth.oauth = oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: strings.TrimRight(c.PublicURL, "/") + "/auth/callback", Scopes: []string{oidc.ScopeOpenID, "profile"}}
	ctx = oidc.ClientContext(ctx, auth.client)
	discovery, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	provider, e := oidc.NewProvider(discovery, c.Issuer)
	if e != nil {
		return e
	}
	auth.issuer = c.Issuer
	auth.oauth.Endpoint = provider.Endpoint()
	auth.verifier = provider.VerifierContext(ctx, &oidc.Config{ClientID: c.ClientID})
	return nil
}
func (a *App) cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.Env == "production", SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (a *App) loginCookieName() string {
	if a.Config.FirebaseHosting {
		return "__session"
	}
	return "portal_login"
}
func (a *App) sessionCookieName() string {
	if a.Config.FirebaseHosting {
		return "__session"
	}
	return "portal_session"
}
func (a *App) signState(st loginState) string {
	b, _ := json.Marshal(st)
	p := base64.RawURLEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, a.auth.secret)
	mac.Write([]byte(p))
	return p + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (a *App) parseState(s string) (loginState, error) {
	var st loginState
	parts := strings.Split(s, ".")
	if len(parts) != 2 {
		return st, errors.New("invalid state")
	}
	mac := hmac.New(sha256.New, a.auth.secret)
	mac.Write([]byte(parts[0]))
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return st, errors.New("invalid state")
	}
	b, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return st, e
	}
	if e = json.Unmarshal(b, &st); e != nil {
		return st, e
	}
	if st.Expires < time.Now().Unix() {
		return st, errors.New("expired state")
	}
	return st, nil
}
func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	st := loginState{randomToken(), randomToken(), oauth2.GenerateVerifier(), time.Now().Add(5 * time.Minute).Unix()}
	opts := []oauth2.AuthCodeOption{oidc.Nonce(st.Nonce), oauth2.S256ChallengeOption(st.Verifier)}

	a.cookie(w, a.loginCookieName(), a.signState(st), 300)
	http.Redirect(w, r, a.auth.oauth.AuthCodeURL(st.State, opts...), http.StatusFound)
	return nil
}
func (a *App) callback(w http.ResponseWriter, r *http.Request) error {
	c, e := r.Cookie(a.loginCookieName())
	if e != nil {
		return fail(400, "oauth_state", "Ungültiger Anmeldevorgang.")
	}
	st, e := a.parseState(c.Value)
	if e != nil || !hmac.Equal([]byte(st.State), []byte(r.URL.Query().Get("state"))) {
		return fail(400, "oauth_state", "Ungültiger Anmeldevorgang.")
	}
	// Consume the transient state only after it is verified. In Hosting mode
	// this cookie may instead be an established opaque session; invalid
	// callbacks must leave that shared cookie intact.
	a.cookie(w, a.loginCookieName(), "", -1)
	ctx, cancel := context.WithTimeout(oidc.ClientContext(r.Context(), a.auth.client), 15*time.Second)
	defer cancel()
	token, e := a.auth.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(st.Verifier))
	if e != nil {
		return fail(401, "oauth_exchange", "Anmeldung fehlgeschlagen.")
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return fail(401, "oauth_token", "Identität konnte nicht bestätigt werden.")
	}
	idToken, e := a.auth.verifier.Verify(ctx, raw)
	if e != nil || !hmac.Equal([]byte(idToken.Nonce), []byte(st.Nonce)) {
		return fail(401, "oauth_token", "Identität konnte nicht bestätigt werden.")
	}
	var claims struct {
		Name string `json:"name"`
	}
	if e = idToken.Claims(&claims); e != nil {
		return fail(401, "oauth_token", "Ungültige Identitätsdaten.")
	}
	subject := a.auth.issuer + "\x1f" + idToken.Subject
	var uid string
	tx, e := a.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	e = tx.QueryRow(ctx, "SELECT id::text FROM users WHERE subject=$1", subject).Scan(&uid)
	if errors.Is(e, pgx.ErrNoRows) {

		uid = ID()
		role := "student"
		admitted := false
		if a.Config.AuthMode == "oidc" && idToken.Subject == a.Config.BootstrapSubject && a.Config.BootstrapSubject != "" {
			role = "admin"
			admitted = true
		}
		name := strings.TrimSpace(claims.Name)
		if name == "" {
			name = "Neues Mitglied"
		}
		if runes := []rune(name); len(runes) > 100 {
			name = string(runes[:100])
		}
		_, e = tx.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted) VALUES($1,$2,$3,$4,$5) ON CONFLICT(subject) DO NOTHING", uid, subject, name, role, admitted)
		if e != nil {
			return e
		}
		if e = tx.QueryRow(ctx, "SELECT id::text FROM users WHERE subject=$1", subject).Scan(&uid); e != nil {
			return e
		}
	} else if e != nil {
		return e
	}
	session, csrf := randomToken(), randomToken()
	if _, e = tx.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(session), uid, csrf, time.Now().Add(24*time.Hour)); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "DELETE FROM sessions WHERE expires_at<now()"); e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	a.cookie(w, a.sessionCookieName(), session, 86400)
	http.Redirect(w, r, "/", http.StatusFound)
	return nil
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) error {
	c, e := r.Cookie(a.sessionCookieName())
	if e == nil {
		if _, e = a.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", digest(c.Value)); e != nil {
			return e
		}
	}
	a.cookie(w, a.sessionCookieName(), "", -1)
	jsonOut(w, 200, map[string]bool{"ok": true})
	return nil
}
