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
	Mail       *MailService
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
	return s.AuthorID == u.ID && s.Status == "pending"
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
	a := &App{DB: db, Config: c, Mail: NewMailService(db, c.Mail), imageSlots: make(chan struct{}, 2)}
	if e := a.setupAuth(ctx); e != nil {
		return nil, e
	}
	if e := a.syncAuthMode(ctx); e != nil {
		return nil, e
	}
	a.routes()
	return a, nil
}
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "same-origin")
	if !(a.Config.dependencyAuth() && (strings.HasPrefix(r.URL.Path, "/auth/") || strings.HasPrefix(r.URL.Path, "/api/auth/"))) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	}
	if a.Config.Env == "production" {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	a.handler.ServeHTTP(w, r)
}
func (a *App) protected(next http.Handler) http.Handler {
	if a.Config.dependencyAuth() {
		return a.dependencyProtected(next)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		cookie, e := r.Cookie("portal_session")
		if e != nil {
			respondError(w, fail(401, "unauthenticated", "Bitte anmelden."))
			return
		}
		if e = a.assertAuthMode(r.Context(), a.DB); e != nil {
			respondError(w, e)
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
	if a.Config.dependencyAuth() {
		m.HandleFunc("/auth/", a.authProxy)
		m.HandleFunc("/api/auth/", a.authProxy)
	}
	m.HandleFunc("POST /internal/email/login", a.endpoint(a.internalEmailLogin))
	api := http.NewServeMux()
	for _, rt := range a.apiRoutes() {
		api.HandleFunc(rt.Pattern, a.endpoint(rt.Handler))
	}
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

func (a *App) me(w http.ResponseWriter, r *http.Request) error {
	u := r.Context().Value(contextKey{}).(requestUser)
	jsonOut(w, 200, Me{User: u.User, CSRFToken: u.CSRF})
	return nil
}

// apiRoutes is the single list of /api/v1 routes: it feeds the mux and the generated docs/openapi.json.
func (a *App) apiRoutes() []apiRoute {
	return []apiRoute{
		{"GET /api/v1/me", a.me, opDoc{Summary: "Current user and CSRF token", Res: Me{}}},
		{"GET /api/v1/me/ballots", a.myBallots, opDoc{Summary: "Current viewer’s own poll submissions, one per current ballot entry including repeatable and hidden collections; never named history or other voters", Res: []MyBallot{}}},
		{"GET /api/v1/categories", a.listCategories, opDoc{Summary: "List collections (students: no drafts; ballot_count and participation editors only)", Res: []Category{}}},
		{"POST /api/v1/categories", a.writeCategory, opDoc{Summary: "Create collection of any kind (admins and managers; manager creator receives a category grant atomically)", Req: CategoryInput{}, Res: Category{}, Status: 201}},
		{"PATCH /api/v1/categories/{id}", a.writeCategory, opDoc{Summary: "Update collection (admin or granted manager); ballot definitions lock after first opening, bounded poll deadlines remain editable with version and closes_at only; repeatable and ongoing fixed after creation; photo collections with active images cannot change to a non-photo kind", Req: CategoryEdit{}, Res: Category{}}},
		{"DELETE /api/v1/categories/{id}", a.deleteCategory, opDoc{Summary: "Delete a single-answer collection and its votes/history (admin only; 400 repeatable, 404 missing, 409 stale version)", Req: VersionInput{}, Status: 204}},
		{"GET /api/v1/submissions", a.listSubmissions, opDoc{Summary: "List authorized submissions", Res: []Submission{}, Query: SubmissionQuery{}}},
		{"POST /api/v1/submissions", a.createSubmission, opDoc{Summary: "Create idempotent contribution; multipart images only for photo collections and create atomically", Req: SubmissionInput{}, Form: SubmissionUpload{}, Res: Submission{}, Status: 201}},
		{"GET /api/v1/submissions/{id}", a.getSubmission, opDoc{Summary: "Read authorized contribution", Res: Submission{}}},
		{"PATCH /api/v1/submissions/{id}", a.editSubmission, opDoc{Summary: "Edit own pending contribution with optimistic concurrency; active images cannot move to a non-photo collection; editorial roles cannot change another author’s original", Req: SubmissionEdit{}, Res: Submission{}}},
		{"POST /api/v1/submissions/{id}/status", a.statusSubmission, opDoc{Summary: "Transition contribution status", Req: StatusInput{}, Res: Submission{}}},
		{"GET /api/v1/submissions/{id}/revisions", a.revisions, opDoc{Summary: "Read contribution revision history", Res: []Revision{}}},
		{"GET /api/v1/submissions/{id}/corrections", a.corrections, opDoc{Summary: "Read correction requests", Res: []Correction{}}},
		{"POST /api/v1/submissions/{id}/corrections", a.addCorrection, opDoc{Summary: "Add editorial annotation with category grant (any status), or author correction request on locked contribution", Req: CommentInput{}, Res: Correction{}, Status: 201}},
		{"POST /api/v1/submissions/{id}/corrections/{correctionID}/resolve", a.resolveCorrection, opDoc{Summary: "Resolve correction request", Res: Correction{}}},
		{"POST /api/v1/submissions/{id}/attachments", a.upload, opDoc{Summary: "Attach image to own pending contribution in a photo collection only; other collection types return 400", Form: AttachmentUpload{}, Res: Submission{}}},
		{"DELETE /api/v1/submissions/{id}/attachments/{attachmentID}", a.deleteAttachment, opDoc{Summary: "Remove attachment from own pending contribution; final image in a photo collection cannot be removed", Req: VersionInput{}, Res: Submission{}}},
		{"PATCH /api/v1/submissions/{id}/attachments/{attachmentID}", a.editAttachment, opDoc{Summary: "Edit photo caption on own pending contribution with optimistic concurrency", Req: AttachmentEdit{}, Res: Submission{}}},
		{"GET /api/v1/attachments/{id}", a.download, opDoc{Summary: "Read authorized original image", File: "application/octet-stream"}},
		{"GET /api/v1/attachments/{id}/preview", a.download, opDoc{Summary: "Read authorized image preview", File: "image/jpeg"}},
		{"GET /api/v1/categories/{id}/export", a.exportCategory, opDoc{Summary: "Export all collected contributions by default, with optional explicit status filter (editors, repeatable only)", File: "application/zip", Query: CategoryExportQuery{}}},
		{"GET /api/v1/categories/{id}/words", a.listWords, opDoc{Summary: "Editorial anonymous original word counts and moderation, word portraits only", Res: []WordEntry{}}},
		{"PATCH /api/v1/categories/{id}/words/{optionID}", a.moderateWord, opDoc{Summary: "Grant-controlled reversible word exclusion/correction/merge; originals and named history stay unchanged", Req: WordModerationInput{}, Res: WordEntry{}}},
		{"GET /api/v1/categories/{id}/words/export", a.exportWords, opDoc{Summary: "Editorial CSV export of included effective words and distinct voter counts, word portraits only", File: "text/csv"}},
		{"POST /api/v1/categories/{id}/status", a.statusCategory, opDoc{Summary: "Open, close or hide a collection (admin or manager with grant; draft->open, open->closed, open/closed->draft). Expired collections cannot reopen. Hiding preserves votes/history and first opened_at; reopening keeps candidates fixed.", Req: CategoryStatusInput{}, Res: Category{}}},
		{"PUT /api/v1/categories/{id}/ballot", a.vote, opDoc{Summary: "Cast a named ballot: replace current selection when one-off; append an idempotent entry when repeatable (ballot_id required)", Req: BallotInput{}, Res: BallotReceipt{}}},
		{"GET /api/v1/categories/{id}/results", a.results, opDoc{Summary: "Editorial aggregate counts (single-answer only)", Res: []PollResult{}}},
		{"GET /api/v1/categories/{id}/audit", a.ballotAudit, opDoc{Summary: "Admin-only named ballot history (single-answer only)", Res: []BallotAudit{}}},
		{"GET /api/v1/roster", a.roster, opDoc{Summary: "Verified cohort names", Res: []RosterEntry{}}},
		{"GET /api/v1/admin/users", a.users, opDoc{Summary: "Admin user list", Res: []User{}}},
		{"PATCH /api/v1/admin/users/{id}", a.editUser, opDoc{Summary: "Admin admission and grants", Req: UserEdit{}, Res: User{}}},
		{"DELETE /api/v1/admin/users/{id}", a.deleteUser, opDoc{Summary: "Delete user without content", Status: 204}},
		{"GET /api/v1/admin/audit", a.auditEvents, opDoc{Summary: "Recent administrative audit events", Res: []AuditEvent{}}},
		{"GET /api/v1/admin/status", a.systemStatus, opDoc{Summary: "Backup freshness and storage", Res: SystemStatus{}}},
		{"GET /api/v1/me/email-reminders", a.emailReminderPreference, opDoc{Summary: "Current user reminder delivery preference", Res: ReminderPreference{}}},
		{"PATCH /api/v1/me/email-reminders", a.emailReminderPreference, opDoc{Summary: "Change own reminder preference; does not affect login email", Req: ReminderPreference{}, Res: ReminderPreference{}}},
		{"GET /api/v1/admin/email/status", a.emailStatus, opDoc{Summary: "Admin-only local quota, observed Brevo credits and worker health; never provider credentials", Res: EmailStatus{}}},
		{"PATCH /api/v1/admin/email/settings", a.emailSettings, opDoc{Summary: "Admin-only versioned mail budgets and pause controls within deployment ceilings", Req: EmailPolicy{}, Res: EmailStatus{}}},
		{"GET /api/v1/admin/email/messages", a.emailMessages, opDoc{Summary: "Admin-only paginated masked delivery metadata; never message bodies or login links", Res: EmailMessages{}, Query: EmailMessagesQuery{}}},
		{"GET /api/v1/admin/email/messages/{id}", a.emailMessageDetail, opDoc{Summary: "Admin-only sanitized delivery attempt and event history", Res: EmailMessageDetail{}}},
		{"POST /api/v1/admin/email/reconcile", a.emailReconcile, opDoc{Summary: "Admin-only rate-limited refresh of provider status and delivery events", Res: EmailStatus{}}},
		{"POST /api/v1/admin/email/reminders/preview", a.emailReminderPreview, opDoc{Summary: "Admin-only aggregate currently eligible reminder count; never sends", Res: ReminderPreview{}}},
		{"GET /api/v1/areas", a.listAreas, opDoc{Summary: "List Bereiche with default reviewers (managers and admins)", Res: []Area{}}},
		{"POST /api/v1/admin/areas", a.createArea, opDoc{Summary: "Create a Bereich (admin)", Req: AreaInput{}, Res: Area{}, Status: 201}},
		{"PATCH /api/v1/admin/areas/{id}", a.editArea, opDoc{Summary: "Rename a Bereich and replace its default reviewers; reviewers must be admitted managers/admins (admin)", Req: AreaEdit{}, Res: Area{}}},
		{"GET /api/v1/tickets", a.listTickets, opDoc{Summary: "List tickets; finished (done and approved) only with include_finished=true", Res: []Ticket{}, Query: TicketQuery{}}},
		{"POST /api/v1/tickets", a.createTicket, opDoc{Summary: "Create a ticket; area reviewers/admins may assign anyone, other managers only themselves", Req: TicketInput{}, Res: Ticket{}, Status: 201}},
		{"GET /api/v1/tickets/{id}", a.getTicket, opDoc{Summary: "Ticket with its timeline", Res: TicketDetail{}}},
		{"PATCH /api/v1/tickets/{id}", a.editTicket, opDoc{Summary: "Edit ticket fields (assignee, area reviewers, admin); changing area, assignee, size or est_pages starts a new review round", Req: TicketEdit{}, Res: Ticket{}}},
		{"POST /api/v1/tickets/{id}/status", a.ticketStatus, opDoc{Summary: "Move a ticket between columns; going back to todo/in_progress starts a new review round", Req: TicketStatusInput{}, Res: Ticket{}}},
		{"POST /api/v1/tickets/{id}/claim", a.claimTicket, opDoc{Summary: "Claim an unassigned ticket atomically and set it in_progress", Res: Ticket{}}},
		{"POST /api/v1/tickets/{id}/comments", a.commentTicket, opDoc{Summary: "Add a markdown comment", Req: CommentInput{}, Res: TicketEvent{}, Status: 201}},
		{"PUT /api/v1/tickets/{id}/review", a.reviewTicket, opDoc{Summary: "Set own review vote in review/done; only binding votes make a ticket approved", Req: ReviewInput{}, Res: Ticket{}}},
	}
}
