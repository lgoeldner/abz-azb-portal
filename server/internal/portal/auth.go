package portal

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type loginState struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
	Expires  int64  `json:"expires"`
}
type mockCode struct {
	Subject, Nonce, Challenge, Redirect string
	Expires                             time.Time
}
type authState struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	key      *rsa.PrivateKey
	secret   []byte
	issuer   string
	mu       sync.Mutex
	codes    map[string]mockCode
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
	auth := &authState{secret: []byte(c.SessionSecret), codes: map[string]mockCode{}}
	if len(auth.secret) == 0 {
		auth.secret = []byte(randomToken())
	}
	a.auth = auth
	auth.oauth = oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: strings.TrimRight(c.PublicURL, "/") + "/auth/callback", Scopes: []string{oidc.ScopeOpenID, "profile"}}
	if c.AuthMode == "mock" {
		key, e := rsa.GenerateKey(rand.Reader, 2048)
		if e != nil {
			return e
		}
		auth.key = key
		auth.issuer = strings.TrimRight(c.PublicURL, "/") + "/dev/oidc"
		auth.oauth.ClientID = "portal-development"
		auth.oauth.ClientSecret = "development-only"
		auth.oauth.Endpoint = oauth2.Endpoint{AuthURL: auth.issuer + "/authorize", TokenURL: auth.issuer + "/token", AuthStyle: oauth2.AuthStyleInParams}
		auth.verifier = oidc.NewVerifier(auth.issuer, oidc.NewRemoteKeySet(ctx, auth.issuer+"/keys"), &oidc.Config{ClientID: auth.oauth.ClientID})
		return nil
	}
	provider, e := oidc.NewProvider(ctx, c.Issuer)
	if e != nil {
		return e
	}
	auth.issuer = c.Issuer
	auth.oauth.Endpoint = provider.Endpoint()
	auth.verifier = provider.Verifier(&oidc.Config{ClientID: c.ClientID})
	return nil
}
func (a *App) cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.Env == "production", SameSite: http.SameSiteLaxMode, MaxAge: age})
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
	if a.Config.AuthMode == "mock" {
		id := r.URL.Query().Get("user")
		if !validID(id) {
			return bad("Bitte eine Entwicklungsidentität auswählen.")
		}
		var exists bool
		if e := a.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND subject=$2)", id, a.auth.issuer+"\x1f"+id).Scan(&exists); e != nil {
			return e
		}
		if !exists {
			return missing()
		}
		opts = append(opts, oauth2.SetAuthURLParam("mock_user", id))
	}
	a.cookie(w, "portal_login", a.signState(st), 300)
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, a.auth.oauth.AuthCodeURL(st.State, opts...), http.StatusFound)
	return nil
}
func (a *App) callback(w http.ResponseWriter, r *http.Request) error {
	c, e := r.Cookie("portal_login")
	if e != nil {
		return fail(400, "oauth_state", "Ungültiger Anmeldevorgang.")
	}
	st, e := a.parseState(c.Value)
	a.cookie(w, "portal_login", "", -1)
	if e != nil || !hmac.Equal([]byte(st.State), []byte(r.URL.Query().Get("state"))) {
		return fail(400, "oauth_state", "Ungültiger Anmeldevorgang.")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
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
		if a.Config.AuthMode == "mock" {
			return fail(401, "oauth_user", "Unbekannte Entwicklungsidentität.")
		}
		uid = ID()
		role := "student"
		admitted := false
		if idToken.Subject == a.Config.BootstrapSubject && a.Config.BootstrapSubject != "" {
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
	a.cookie(w, "portal_session", session, 86400)
	http.Redirect(w, r, "/", http.StatusFound)
	return nil
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) error {
	c, e := r.Cookie("portal_session")
	if e == nil {
		if _, e = a.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", digest(c.Value)); e != nil {
			return e
		}
	}
	a.cookie(w, "portal_session", "", -1)
	jsonOut(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) mockRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /auth/mock/users", a.endpoint(func(w http.ResponseWriter, r *http.Request) error {
		rows, e := a.DB.Query(r.Context(), "SELECT id::text,name,role FROM users WHERE subject LIKE $1 ORDER BY role,name", a.auth.issuer+"\x1f%")
		if e != nil {
			return e
		}
		defer rows.Close()
		out := []map[string]string{}
		for rows.Next() {
			var id, name, role string
			if e = rows.Scan(&id, &name, &role); e != nil {
				return e
			}
			out = append(out, map[string]string{"id": id, "name": name, "role": role})
		}
		if e = rows.Err(); e != nil {
			return e
		}
		jsonOut(w, 200, out)
		return nil
	}))
	m.HandleFunc("GET /dev/oidc/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		i := a.auth.issuer
		jsonOut(w, 200, map[string]any{"issuer": i, "authorization_endpoint": i + "/authorize", "token_endpoint": i + "/token", "jwks_uri": i + "/keys", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "code_challenge_methods_supported": []string{"S256"}})
	})
	m.HandleFunc("GET /dev/oidc/keys", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &a.auth.key.PublicKey, KeyID: "dev", Algorithm: "RS256", Use: "sig"}}})
	})
	m.HandleFunc("GET /dev/oidc/authorize", a.endpoint(a.mockAuthorize))
	m.HandleFunc("POST /dev/oidc/token", a.endpoint(a.mockToken))
}
func (a *App) mockAuthorize(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	if q.Get("client_id") != a.auth.oauth.ClientID || q.Get("redirect_uri") != a.auth.oauth.RedirectURL || q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("nonce") == "" || q.Get("state") == "" {
		return bad("Ungültige OAuth-Anfrage.")
	}
	id := q.Get("mock_user")
	if !validID(id) {
		return bad("Ungültige Identität.")
	}
	var exists bool
	if e := a.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND subject=$2)", id, a.auth.issuer+"\x1f"+id).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		return missing()
	}
	code := randomToken()
	a.auth.mu.Lock()
	for k, c := range a.auth.codes {
		if time.Now().After(c.Expires) {
			delete(a.auth.codes, k)
		}
	}
	a.auth.codes[code] = mockCode{id, q.Get("nonce"), q.Get("code_challenge"), q.Get("redirect_uri"), time.Now().Add(time.Minute)}
	a.auth.mu.Unlock()
	u, _ := url.Parse(q.Get("redirect_uri"))
	params := u.Query()
	params.Set("state", q.Get("state"))
	params.Set("code", code)
	u.RawQuery = params.Encode()
	http.Redirect(w, r, u.String(), 302)
	return nil
}
func (a *App) mockToken(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if e := r.ParseForm(); e != nil {
		return bad("Ungültige Token-Anfrage.")
	}
	if r.Form.Get("client_id") != a.auth.oauth.ClientID || r.Form.Get("client_secret") != a.auth.oauth.ClientSecret || r.Form.Get("grant_type") != "authorization_code" {
		return fail(401, "invalid_client", "Invalid client")
	}
	a.auth.mu.Lock()
	code, ok := a.auth.codes[r.Form.Get("code")]
	delete(a.auth.codes, r.Form.Get("code"))
	a.auth.mu.Unlock()
	h := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
	if !ok || time.Now().After(code.Expires) || code.Redirect != r.Form.Get("redirect_uri") || base64.RawURLEncoding.EncodeToString(h[:]) != code.Challenge {
		return fail(400, "invalid_grant", "Invalid grant")
	}
	var name string
	if e := a.DB.QueryRow(r.Context(), "SELECT name FROM users WHERE id=$1", code.Subject).Scan(&name); e != nil {
		return e
	}
	now := time.Now()
	claims, _ := json.Marshal(map[string]any{"iss": a.auth.issuer, "sub": code.Subject, "aud": a.auth.oauth.ClientID, "exp": now.Add(5 * time.Minute).Unix(), "iat": now.Unix(), "nonce": code.Nonce, "name": name})
	signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: a.auth.key, KeyID: "dev"}}, (&jose.SignerOptions{}).WithType("JWT"))
	if e != nil {
		return e
	}
	signed, e := signer.Sign(claims)
	if e != nil {
		return e
	}
	jwt, e := signed.CompactSerialize()
	if e != nil {
		return e
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonOut(w, 200, map[string]any{"access_token": randomToken(), "token_type": "Bearer", "expires_in": 300, "id_token": jwt})
	return nil
}
