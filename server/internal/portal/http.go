package portal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type App struct {
	DB         *pgxpool.Pool
	Config     Config
	auth       *authState
	handler    http.Handler
	imageSlots chan struct{}
}
type requestUser struct {
	User User
	CSRF string
}
type contextKey struct{}
type apiError struct {
	Status        int
	Code, Message string
}

func (e *apiError) Error() string                 { return e.Message }
func fail(status int, code, message string) error { return &apiError{status, code, message} }
func bad(message string) error                    { return fail(400, "validation", message) }
func forbidden() error                            { return fail(403, "forbidden", "Keine Berechtigung.") }
func missing() error                              { return fail(404, "not_found", "Eintrag nicht gefunden.") }
func conflict() error {
	return fail(409, "conflict", "Der Eintrag wurde geändert oder die Aktion ist nicht mehr möglich.")
}
func current(r *http.Request) User { return r.Context().Value(contextKey{}).(requestUser).User }
func editor(u User) bool           { return u.Role == "manager" || u.Role == "admin" }
func canEdit(u User, category string) bool {
	if u.Role == "admin" {
		return true
	}
	if u.Role != "manager" {
		return false
	}
	for _, id := range u.CategoryIDs {
		if id == category {
			return true
		}
	}
	return false
}
func canRead(u User, s Submission) bool { return editor(u) || s.AuthorID == u.ID }
func canMutate(u User, s Submission) bool {
	return canEdit(u, s.CategoryID) || (s.AuthorID == u.ID && s.Status == "pending")
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func validID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			return fail(413, "too_large", "Anfrage zu groß.")
		}
		return bad("Ungültige JSON-Daten.")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return bad("Genau ein JSON-Objekt erwartet.")
	}
	return nil
}
func respondError(w http.ResponseWriter, e error) {
	ae := &apiError{500, "internal", "Interner Fehler."}
	var specific *apiError
	if errors.As(e, &specific) {
		ae = specific
	} else if errors.Is(e, pgx.ErrNoRows) {
		ae = &apiError{404, "not_found", "Eintrag nicht gefunden."}
	} else {
		var pe *pgconn.PgError
		if errors.As(e, &pe) {
			switch pe.Code {
			case "23503", "22P02", "23514":
				ae = &apiError{400, "validation", "Ungültiger Verweis oder Wert."}
			case "23505", "40001", "40P01":
				ae = &apiError{409, "conflict", "Konflikt mit einem vorhandenen Eintrag."}
			}
		}
		if ae.Status == 500 {
			slog.Error("request failed", "error", e)
		}
	}
	jsonOut(w, ae.Status, map[string]any{"error": map[string]string{"code": ae.Code, "message": ae.Message}})
}

type endpoint func(http.ResponseWriter, *http.Request) error

func (a *App) endpoint(fn endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if e := fn(w, r); e != nil {
			respondError(w, e)
		}
	}
}
func New(ctx context.Context, c Config, db *pgxpool.Pool) (*App, error) {
	if e := c.Validate(); e != nil {
		return nil, e
	}
	if e := os.MkdirAll(c.UploadDir, 0700); e != nil {
		return nil, e
	}
	a := &App{DB: db, Config: c, imageSlots: make(chan struct{}, 2)}
	if e := a.setupAuth(ctx); e != nil {
		return nil, e
	}
	a.routes()
	return a, nil
}
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	if a.Config.Env == "production" {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	a.handler.ServeHTTP(w, r)
}
func (a *App) protected(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		cookie, e := r.Cookie("portal_session")
		if e != nil {
			respondError(w, fail(401, "unauthenticated", "Bitte anmelden."))
			return
		}
		var uid, csrf string
		e = a.DB.QueryRow(r.Context(), "SELECT user_id::text,csrf FROM sessions WHERE token_hash=$1 AND expires_at>now()", digest(cookie.Value)).Scan(&uid, &csrf)
		if e != nil {
			if !errors.Is(e, pgx.ErrNoRows) {
				respondError(w, e)
			} else {
				respondError(w, fail(401, "unauthenticated", "Bitte erneut anmelden."))
			}
			return
		}
		u, e := scanUser(a.DB.QueryRow(r.Context(), "SELECT "+userCols+" FROM users WHERE id=$1", uid))
		if e != nil {
			respondError(w, e)
			return
		}
		if !u.Admitted && r.URL.Path != "/api/v1/me" && r.URL.Path != "/auth/logout" {
			respondError(w, forbidden())
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			if subtle.ConstantTimeCompare([]byte(csrf), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
				respondError(w, fail(403, "csrf", "Ungültiges CSRF-Token."))
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && origin != strings.TrimRight(a.Config.PublicURL, "/") {
				respondError(w, forbidden())
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), contextKey{}, requestUser{u, csrf})))
	})
}
func (a *App) routes() {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { jsonOut(w, 200, map[string]string{"status": "ok"}) })
	m.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if a.DB.Ping(ctx) != nil {
			jsonOut(w, 503, map[string]string{"status": "unavailable"})
			return
		}
		jsonOut(w, 200, map[string]string{"status": "ready"})
	})
	m.HandleFunc("GET /auth/login", a.endpoint(a.login))
	m.HandleFunc("GET /auth/callback", a.endpoint(a.callback))
	m.Handle("POST /auth/logout", a.protected(a.endpoint(a.logout)))
	api := http.NewServeMux()
	bind := func(pattern string, fn endpoint) { api.HandleFunc(pattern, a.endpoint(fn)) }
	bind("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) error {
		u := r.Context().Value(contextKey{}).(requestUser)
		jsonOut(w, 200, map[string]any{"user": u.User, "csrf_token": u.CSRF})
		return nil
	})
	bind("GET /api/v1/categories", a.listCategories)
	bind("POST /api/v1/categories", a.writeCategory)
	bind("PATCH /api/v1/categories/{id}", a.writeCategory)
	bind("GET /api/v1/submissions", a.listSubmissions)
	bind("POST /api/v1/submissions", a.createSubmission)
	bind("GET /api/v1/submissions/{id}", a.getSubmission)
	bind("PATCH /api/v1/submissions/{id}", a.editSubmission)
	bind("POST /api/v1/submissions/{id}/status", a.statusSubmission)
	bind("GET /api/v1/submissions/{id}/revisions", a.revisions)
	bind("GET /api/v1/submissions/{id}/corrections", a.corrections)
	bind("POST /api/v1/submissions/{id}/corrections", a.addCorrection)
	bind("POST /api/v1/submissions/{id}/corrections/{correctionID}/resolve", a.resolveCorrection)
	bind("POST /api/v1/submissions/{id}/attachments", a.upload)
	bind("DELETE /api/v1/submissions/{id}/attachments/{attachmentID}", a.deleteAttachment)
	bind("GET /api/v1/attachments/{id}", a.download)
	bind("GET /api/v1/attachments/{id}/preview", a.download)
	bind("GET /api/v1/categories/{id}/export", a.exportCategory)
	bind("GET /api/v1/polls", a.listPolls)
	bind("POST /api/v1/polls", a.writePoll)
	bind("PATCH /api/v1/polls/{id}", a.writePoll)
	bind("POST /api/v1/polls/{id}/status", a.statusPoll)
	bind("PUT /api/v1/polls/{id}/ballot", a.vote)
	bind("GET /api/v1/polls/{id}/results", a.results)
	bind("GET /api/v1/polls/{id}/audit", a.ballotAudit)
	bind("GET /api/v1/roster", a.roster)
	bind("GET /api/v1/admin/users", a.users)
	bind("PATCH /api/v1/admin/users/{id}", a.editUser)
	bind("DELETE /api/v1/admin/users/{id}", a.deleteUser)
	bind("GET /api/v1/admin/audit", a.auditEvents)
	bind("GET /api/v1/admin/status", a.systemStatus)
	api.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { respondError(w, missing()) })
	m.Handle("/api/", a.protected(api))
	m.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/dev/") || r.Method != "GET" && r.Method != "HEAD" {
			respondError(w, missing())
			return
		}
		p := filepath.Join(a.Config.StaticDir, filepath.Clean("/"+r.URL.Path))
		if st, e := os.Stat(p); e == nil && !st.IsDir() {
			http.ServeFile(w, r, p)
			return
		}
		http.ServeFile(w, r, filepath.Join(a.Config.StaticDir, "index.html"))
	})
	a.handler = m
}
