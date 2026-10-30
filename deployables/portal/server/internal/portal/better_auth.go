package portal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/csrf"
	"github.com/jackc/pgx/v5"
)

// The dependency owns cookies and sessions. Only its authenticated internal API
// resolves an opaque browser cookie to a UUID; portal permissions stay local.
func (a *App) dependencyUser(r *http.Request) (User, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(a.Config.AuthInternalURL, "/")+"/internal/session", nil)
	if err != nil {
		return User{}, fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	req.Header.Set("Authorization", "Bearer "+a.Config.AuthServiceSecret)
	req.Header.Set("Cookie", r.Header.Get("Cookie"))
	res, err := a.auth.client.Do(req)
	if err != nil {
		return User{}, fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		return User{}, fail(401, "unauthenticated", "Bitte erneut anmelden.")
	}
	if res.StatusCode != 200 {
		return User{}, fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	var session struct {
		UserID    string    `json:"user_id"`
		SessionID string    `json:"session_id"`
		ExpiresAt time.Time `json:"expires_at"`
		Mode      string    `json:"mode"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(&session); err != nil || !validID(session.UserID) || !validID(session.SessionID) || !session.ExpiresAt.After(time.Now()) || session.Mode != a.Config.AuthMode {
		return User{}, fail(401, "unauthenticated", "Bitte erneut anmelden.")
	}
	var activeMode string
	if err = a.DB.QueryRow(ctx, "SELECT mode FROM auth_runtime_state WHERE singleton").Scan(&activeMode); err != nil || activeMode != a.Config.AuthMode {
		return User{}, fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	user, err := scanUser(a.DB.QueryRow(ctx, "SELECT "+userCols+" FROM users WHERE id=$1 AND login_enabled", session.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, fail(401, "unauthenticated", "Bitte erneut anmelden.")
	}
	return user, err
}
func (a *App) dependencyProtected(next http.Handler) http.Handler {
	key := sha256.Sum256(a.auth.secret)
	guarded := csrf.Protect(key[:], csrf.Secure(a.Config.Env == "production"), csrf.CookieName("portal_csrf"), csrf.Path("/"), csrf.SameSite(csrf.SameSiteLaxMode), csrf.ErrorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		respondError(w, fail(403, "csrf", "Ungültiges CSRF-Token."))
	})))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ru := r.Context().Value(contextKey{}).(requestUser)
		ru.CSRF = csrf.Token(r)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, ru)))
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		user, err := a.dependencyUser(r)
		if err != nil {
			respondError(w, err)
			return
		}
		if !user.Admitted && r.URL.Path != "/api/v1/me" && r.URL.Path != "/auth/logout" {
			respondError(w, forbidden())
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if origin := r.Header.Get("Origin"); origin != "" && origin != strings.TrimRight(a.Config.PublicURL, "/") {
				respondError(w, forbidden())
				return
			}
		}
		r = r.WithContext(context.WithValue(r.Context(), contextKey{}, requestUser{User: user}))
		// The trusted proxy terminates HTTPS; only local development is plaintext.
		if a.Config.Env == "development" {
			r = csrf.PlaintextHTTPRequest(r)
		}
		guarded.ServeHTTP(w, r)
	})
}

// clientIP only accepts forwarded identities from explicitly configured proxies.
func (a *App) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return ""
	}
	peer = peer.Unmap()
	trusted := func(ip netip.Addr) bool {
		for _, value := range strings.Split(a.Config.TrustedProxyCIDRs, ",") {
			prefix, e := netip.ParsePrefix(strings.TrimSpace(value))
			if e == nil && prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	authenticatedProxy := len(a.Config.AuthServiceSecret) >= 32 && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Portal-Proxy-Token")), []byte(a.Config.AuthServiceSecret)) == 1
	if !trusted(peer) && !authenticatedProxy {
		return peer.String()
	}
	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(chain) - 1; i >= 0; i-- {
		addr, e := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if e != nil {
			return peer.String()
		}
		addr = addr.Unmap()
		if !trusted(addr) {
			return addr.String()
		}
	}
	return peer.String()
}
func (a *App) authProxy(w http.ResponseWriter, r *http.Request) {
	target, _ := url.Parse(a.Config.AuthInternalURL)
	public, _ := url.Parse(a.Config.PublicURL)
	proxy := &httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(target)
		p.Out.Header.Del("Authorization")
		p.Out.Header.Del("X-User-Id")
		p.Out.Header.Del("X-User-Role")
		p.Out.Header.Del("X-Portal-Proxy-Token")
		p.Out.Header.Del("Forwarded")
		p.Out.Header.Del("X-Real-IP")
		p.Out.Header.Del("X-Forwarded-For")
		if ip := a.clientIP(p.In); ip != "" {
			p.Out.Header.Set("X-Forwarded-For", ip)
			p.Out.Header.Set("X-Real-IP", ip)
		}
		p.Out.Header.Set("X-Forwarded-Proto", public.Scheme)
		p.Out.Header.Set("X-Forwarded-Host", public.Host)
	}, Transport: a.auth.client.Transport, ErrorHandler: func(w http.ResponseWriter, r *http.Request, _ error) {
		respondError(w, fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar."))
	}}
	proxy.ServeHTTP(w, r)
}

func (a *App) assertAuthMode(ctx context.Context, db DB) error {
	var present bool
	if err := db.QueryRow(ctx, "SELECT to_regclass('auth_runtime_state') IS NOT NULL").Scan(&present); err != nil {
		return fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	// Historical migration tests construct a development app on old schemas.
	if !present && a.Config.Env == "development" && !a.Config.dependencyAuth() {
		return nil
	}
	var mode string
	if !present {
		return fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	if err := db.QueryRow(ctx, "SELECT mode FROM auth_runtime_state WHERE singleton").Scan(&mode); err != nil || mode != a.Config.AuthMode {
		return fail(503, "auth_unavailable", "Anmeldung vorübergehend nicht erreichbar.")
	}
	return nil
}
func (a *App) syncAuthMode(ctx context.Context) error {
	var present bool
	if err := a.DB.QueryRow(ctx, "SELECT to_regclass('auth_runtime_state') IS NOT NULL").Scan(&present); err != nil {
		return err
	}
	if !present && a.Config.Env == "development" && !a.Config.dependencyAuth() {
		return nil
	}

	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120984)"); err != nil {
		return err
	}
	var mode string
	err = tx.QueryRow(ctx, "SELECT mode FROM auth_runtime_state WHERE singleton FOR UPDATE").Scan(&mode)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, "INSERT INTO auth_runtime_state(singleton,mode) VALUES(true,$1)", a.Config.AuthMode)
	} else if err == nil && mode != a.Config.AuthMode {
		_, err = tx.Exec(ctx, "DELETE FROM sessions; DELETE FROM auth_sessions; DELETE FROM auth_verifications")
		if err == nil {
			_, err = tx.Exec(ctx, "UPDATE auth_runtime_state SET mode=$1 WHERE singleton", a.Config.AuthMode)
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
