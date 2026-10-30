package portal

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	mailDefaultDailyLimit    = 300
	mailDefaultReminderLimit = 150
	mailDefaultLoginReserve  = 150
	mailMaxConfiguredLimit   = 100000
	mailAdminEntityID        = "00000000-0000-4000-8000-000000000001"
)

// MailConfig carries deployment safety ceilings separately from the persisted
// operator policy. Database policy changes can never exceed these ceilings.
type MailConfig struct {
	Provider         string
	APIKey           string
	From             string
	ReplyTo          string
	BaseURL          string
	PublicURL        string
	TrackingDisabled bool
	DailyLimit       int
	ReminderLimit    int
	LoginReserve     int
	RemindersEnabled bool
}

// LoadMailConfig loads mail-only settings. The development default captures
// sends locally and production requires an explicitly configured Brevo sender.
func LoadMailConfig(appEnv string) (MailConfig, error) {
	provider := strings.TrimSpace(os.Getenv("MAIL_PROVIDER"))
	if provider == "" {
		if appEnv == "development" {
			provider = "capture"
		} else {
			provider = "brevo"
		}
	}
	c := MailConfig{
		Provider:         provider,
		APIKey:           strings.TrimSpace(os.Getenv("BREVO_API_KEY")),
		From:             strings.TrimSpace(os.Getenv("MAIL_FROM")),
		ReplyTo:          strings.TrimSpace(os.Getenv("MAIL_REPLY_TO")),
		BaseURL:          strings.TrimRight(strings.TrimSpace(os.Getenv("BREVO_API_URL")), "/"),
		DailyLimit:       mailDefaultDailyLimit,
		ReminderLimit:    mailDefaultReminderLimit,
		LoginReserve:     mailDefaultLoginReserve,
		TrackingDisabled: false,
	}
	if c.BaseURL == "" {
		c.BaseURL = "https://api.brevo.com/v3"
	}
	if err := setMailInt("MAIL_DAILY_LIMIT", &c.DailyLimit, 1, mailMaxConfiguredLimit); err != nil {
		return MailConfig{}, err
	}
	if err := setMailInt("REMINDER_DAILY_LIMIT", &c.ReminderLimit, 0, mailMaxConfiguredLimit); err != nil {
		return MailConfig{}, err
	}
	if err := setMailInt("MAIL_LOGIN_RESERVE", &c.LoginReserve, 0, mailMaxConfiguredLimit); err != nil {
		return MailConfig{}, err
	}
	if c.ReminderLimit+c.LoginReserve > c.DailyLimit {
		return MailConfig{}, errors.New("reminder budget plus login reserve must fit the daily mail limit")
	}
	if c.Provider != "capture" && c.Provider != "brevo" {
		return MailConfig{}, errors.New("MAIL_PROVIDER must be brevo or capture")
	}
	if appEnv == "production" {
		if c.Provider != "brevo" || c.APIKey == "" || !validMailAddress(c.From) {
			return MailConfig{}, errors.New("production requires Brevo credentials and a valid MAIL_FROM address")
		}
	}
	if c.Provider == "capture" && appEnv != "development" {
		return MailConfig{}, errors.New("local mail capture is only allowed in development")
	}
	if c.Provider == "brevo" && c.APIKey == "" {
		return MailConfig{}, errors.New("BREVO_API_KEY is required for Brevo delivery")
	}
	if c.Provider == "brevo" {
		trackingDisabled, err := strconv.ParseBool(strings.TrimSpace(os.Getenv("BREVO_TRACKING_DISABLED")))
		if err != nil || !trackingDisabled {
			return MailConfig{}, errors.New("BREVO_TRACKING_DISABLED must be true after open and click tracking are disabled in Brevo")
		}
		c.TrackingDisabled = true
	}
	if c.From != "" && !validMailAddress(c.From) {
		return MailConfig{}, errors.New("MAIL_FROM must contain a valid email address")
	}
	if c.ReplyTo != "" && !validMailAddress(c.ReplyTo) {
		return MailConfig{}, errors.New("MAIL_REPLY_TO must contain a valid email address")
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return MailConfig{}, errors.New("BREVO_API_URL must be an HTTPS origin or API base path")
	}
	reminders := strings.TrimSpace(os.Getenv("REMINDERS_ENABLED"))
	if reminders != "" {
		v, err := strconv.ParseBool(reminders)
		if err != nil {
			return MailConfig{}, errors.New("REMINDERS_ENABLED must be true or false")
		}
		c.RemindersEnabled = v
	}
	return c, nil
}

func setMailInt(name string, target *int, min, max int) error {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < min || n > max {
		return fmt.Errorf("%s is outside its allowed range", name)
	}
	*target = n
	return nil
}

func validMailAddress(value string) bool {
	if value == "" || strings.ContainsAny(value, "\r\n\x00") {
		return false
	}
	a, err := mail.ParseAddress(value)
	return err == nil && a.Address != "" && strings.Contains(a.Address, "@")
}

type MailService struct {
	db     *pgxpool.Pool
	config MailConfig
	client *http.Client
}

func NewMailService(db *pgxpool.Pool, config MailConfig) *MailService {
	return &MailService{db: db, config: config, client: &http.Client{Timeout: 12 * time.Second}}
}

type mailPolicy struct {
	Version       int  `json:"version"`
	Paused        bool `json:"paused"`
	PauseAll      bool `json:"pause_all"`
	DailyLimit    int  `json:"daily_limit"`
	ReminderLimit int  `json:"reminder_limit"`
	LoginReserve  int  `json:"login_reserve"`
}

type mailUsage struct {
	Day       string `json:"day"`
	Used      int    `json:"used"`
	Reserved  int    `json:"reserved"`
	Login     int    `json:"login"`
	Reminder  int    `json:"reminder"`
	Remaining int    `json:"remaining"`
}

type mailProviderStatus struct {
	Name       string     `json:"name"`
	Configured bool       `json:"configured"`
	Credits    *int       `json:"credits"`
	ObservedAt *time.Time `json:"observed_at"`
	Error      *string    `json:"error"`
}

type mailHealth struct {
	LastWorkerRun *time.Time `json:"last_worker_run"`
	Pending       int        `json:"pending"`
	Failed        int        `json:"failed"`
}

type emailStatusResponse struct {
	Policy   mailPolicy         `json:"policy"`
	Usage    mailUsage          `json:"usage"`
	Provider mailProviderStatus `json:"provider"`
	Health   mailHealth         `json:"health"`
}

func (m *MailService) ensurePolicy(ctx context.Context) error {
	if m == nil || m.db == nil {
		return errors.New("mail service unavailable")
	}
	_, err := m.db.Exec(ctx, `INSERT INTO mail_policy(id,daily_limit,reminder_limit,login_reserve)
VALUES (1,$1,$2,$3) ON CONFLICT(id) DO NOTHING`, m.config.DailyLimit, m.config.ReminderLimit, m.config.LoginReserve)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(ctx, `UPDATE mail_policy SET daily_limit=LEAST(daily_limit,$1),
reminder_limit=LEAST(reminder_limit,$2), login_reserve=LEAST(login_reserve,$3), version=version+1
WHERE id=1 AND (daily_limit>$1 OR reminder_limit>$2 OR login_reserve>$3)`, m.config.DailyLimit, m.config.ReminderLimit, m.config.LoginReserve)
	return err
}

func (m *MailService) effectivePolicy(ctx context.Context) (mailPolicy, error) {
	if err := m.ensurePolicy(ctx); err != nil {
		return mailPolicy{}, err
	}
	var p mailPolicy
	err := m.db.QueryRow(ctx, `SELECT version,paused,pause_all,
LEAST(daily_limit,$1),LEAST(reminder_limit,$2),LEAST(login_reserve,$3)
FROM mail_policy WHERE id=1`, m.config.DailyLimit, m.config.ReminderLimit, m.config.LoginReserve).Scan(
		&p.Version, &p.Paused, &p.PauseAll, &p.DailyLimit, &p.ReminderLimit, &p.LoginReserve)
	return p, err
}

func (m *MailService) status(ctx context.Context) (emailStatusResponse, error) {
	p, err := m.effectivePolicy(ctx)
	if err != nil {
		return emailStatusResponse{}, err
	}
	day := time.Now().UTC().Format("2006-01-02")
	var usage mailUsage
	usage.Day = day
	err = m.db.QueryRow(ctx, `SELECT
count(*) FILTER (WHERE state='consumed'),
count(*) FILTER (WHERE state IN ('reserved','uncertain')),
count(*) FILTER (WHERE state='consumed' AND kind='login'),
count(*) FILTER (WHERE state='consumed' AND kind='reminder')
FROM mail_reservations WHERE quota_day=$1::date`, day).Scan(&usage.Used, &usage.Reserved, &usage.Login, &usage.Reminder)
	if err != nil {
		return emailStatusResponse{}, err
	}
	usage.Remaining = p.DailyLimit - usage.Used - usage.Reserved
	if usage.Remaining < 0 {
		usage.Remaining = 0
	}
	var credits *int
	var observed *time.Time
	var providerErr *string
	var lastWorker *time.Time
	var pending, failed int
	err = m.db.QueryRow(ctx, `SELECT provider_credits,provider_observed_at,provider_error,last_worker_run FROM mail_policy WHERE id=1`).Scan(&credits, &observed, &providerErr, &lastWorker)
	if err != nil {
		return emailStatusResponse{}, err
	}
	if m.config.Provider != "brevo" {
		credits, observed, providerErr = nil, nil, nil
	}
	err = m.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status IN ('queued','unknown')),
count(*) FILTER (WHERE status='failed') FROM mail_messages`).Scan(&pending, &failed)
	if err != nil {
		return emailStatusResponse{}, err
	}
	return emailStatusResponse{
		Policy: p,
		Usage:  usage,
		Provider: mailProviderStatus{
			Name:       m.config.Provider,
			Configured: m.config.Provider == "capture" || m.config.APIKey != "" && m.config.From != "" && m.config.TrackingDisabled,
			Credits:    credits,
			ObservedAt: observed,
			Error:      providerErr,
		},
		Health: mailHealth{LastWorkerRun: lastWorker, Pending: pending, Failed: failed},
	}, nil
}

func (a *App) requireMailAdmin(r *http.Request) error {
	u := current(r)
	if !u.Admitted || u.Role != "admin" {
		return forbidden()
	}
	return nil
}

func (a *App) emailStatus(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	if a.Mail == nil {
		return fail(503, "mail_unavailable", "E-Mail-Dienst nicht verfügbar.")
	}
	out, err := a.Mail.status(r.Context())
	if err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, out)
	return nil
}

func (a *App) emailSettings(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	if a.Mail == nil {
		return fail(503, "mail_unavailable", "E-Mail-Dienst nicht verfügbar.")
	}
	var in mailPolicy
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if in.Version < 1 || in.DailyLimit < 1 || in.DailyLimit > a.Mail.config.DailyLimit || in.ReminderLimit < 0 || in.ReminderLimit > a.Mail.config.ReminderLimit || in.LoginReserve < 0 || in.LoginReserve > a.Mail.config.LoginReserve || in.ReminderLimit+in.LoginReserve > in.DailyLimit {
		return bad("Ungültige E-Mail-Budgets oder Reserven.")
	}
	ctx := r.Context()
	if err := a.Mail.ensurePolicy(ctx); err != nil {
		return err
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var before mailPolicy
	if err = tx.QueryRow(ctx, `SELECT version,paused,pause_all,daily_limit,reminder_limit,login_reserve
FROM mail_policy WHERE id=1 FOR UPDATE`).Scan(&before.Version, &before.Paused, &before.PauseAll, &before.DailyLimit, &before.ReminderLimit, &before.LoginReserve); err != nil {
		return err
	}
	if before.Version != in.Version {
		return fail(409, "stale_version", "Die E-Mail-Einstellungen wurden zwischenzeitlich geändert.")
	}
	var after mailPolicy
	err = tx.QueryRow(ctx, `UPDATE mail_policy SET version=version+1,paused=$2,pause_all=$3,
daily_limit=$4,reminder_limit=$5,login_reserve=$6 WHERE id=1 AND version=$1
RETURNING version,paused,pause_all,daily_limit,reminder_limit,login_reserve`,
		before.Version, in.Paused, in.PauseAll, in.DailyLimit, in.ReminderLimit, in.LoginReserve).Scan(
		&after.Version, &after.Paused, &after.PauseAll, &after.DailyLimit, &after.ReminderLimit, &after.LoginReserve)
	if err != nil {
		return err
	}
	details, _ := json.Marshal(map[string]any{"before": before, "after": after})
	if _, err = tx.Exec(ctx, `INSERT INTO mail_admin_events(id,actor_id,action,details) VALUES($1,$2,'settings_updated',$3::jsonb)`, ID(), current(r).ID, string(details)); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,action,entity_id) VALUES($1,$2,'email.settings.updated',$3)`, ID(), current(r).ID, mailAdminEntityID); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	status, err := a.Mail.status(ctx)
	if err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, status)
	return nil
}

type emailMessageItem struct {
	ID                string    `json:"id"`
	CreatedAt         time.Time `json:"created_at"`
	UserID            *string   `json:"user_id"`
	UserName          *string   `json:"user_name"`
	RecipientMasked   string    `json:"recipient_masked"`
	Kind              string    `json:"kind"`
	Status            string    `json:"status"`
	ProviderMessageID *string   `json:"provider_message_id"`
	Attempts          int       `json:"attempts"`
	FailureCode       *string   `json:"failure_code"`
}

func maskEmail(s string) string {
	local, domain, ok := strings.Cut(s, "@")
	if !ok || local == "" || domain == "" {
		return "••••"
	}
	first := []rune(local)[0]
	return string(first) + "•••@" + domain
}

type mailCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
}

func encodeMailCursor(v mailCursor) string {
	b, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeMailCursor(s string) (mailCursor, error) {
	var out mailCursor
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || len(b) > 256 || json.Unmarshal(b, &out) != nil || out.CreatedAt.IsZero() || !validID(out.ID) {
		return mailCursor{}, errors.New("invalid cursor")
	}
	return out, nil
}

func (a *App) emailMessages(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	q := r.URL.Query()
	limit := 50
	if raw := q.Get("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 || v > 100 {
			return bad("Limit muss zwischen 1 und 100 liegen.")
		}
		limit = v
	}
	kind, status, userID := q.Get("kind"), q.Get("status"), q.Get("user_id")
	if kind != "" && kind != "login" && kind != "reminder" {
		return bad("Ungültiger E-Mail-Typ.")
	}
	if status != "" && !mailMessageStatus(status) {
		return bad("Ungültiger E-Mail-Status.")
	}
	if userID != "" && !validID(userID) {
		return bad("Ungültige Personen-ID.")
	}
	var from, to *time.Time
	if raw := q.Get("from"); raw != "" {
		v, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return bad("Der Beginn muss ein RFC3339-Zeitpunkt sein.")
		}
		v = v.UTC()
		from = &v
	}
	if raw := q.Get("to"); raw != "" {
		v, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return bad("Das Ende muss ein RFC3339-Zeitpunkt sein.")
		}
		v = v.UTC()
		to = &v
	}
	if from != nil && to == nil {
		v := time.Now().UTC()
		to = &v
	}
	if to != nil && from == nil {
		v := to.Add(-90 * 24 * time.Hour)
		from = &v
	}
	if from != nil && (to.Before(*from) || to.Sub(*from) > 90*24*time.Hour || from.Before(time.Now().UTC().Add(-90*24*time.Hour)) || to.After(time.Now().UTC().Add(5*time.Minute))) {
		return bad("Der Zeitraum muss höchstens 90 Tage umfassen und darf nicht in der Zukunft liegen.")
	}
	var cursor *mailCursor
	if raw := q.Get("cursor"); raw != "" {
		v, err := decodeMailCursor(raw)
		if err != nil {
			return bad("Ungültiger Cursor.")
		}
		cursor = &v
	}
	args := []any{kind, status, userID, from, to, limit + 1}
	where := `($1='' OR m.kind=$1) AND ($2='' OR m.status=$2) AND ($3='' OR m.user_id::text=$3)
AND ($4::timestamptz IS NULL OR m.created_at>=$4) AND ($5::timestamptz IS NULL OR m.created_at<=$5)`
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		where += fmt.Sprintf(" AND (m.created_at,m.id)<($%d,$%d)", len(args)-1, len(args))
	}
	rows, err := a.DB.Query(r.Context(), `SELECT m.id::text,m.created_at,m.user_id::text,u.name,d.recipient_snapshot,
m.kind,m.status,m.provider_message_id,m.failure_code,
(SELECT count(*) FROM mail_attempts a WHERE a.message_id=m.id)
FROM mail_messages m LEFT JOIN users u ON u.id=m.user_id JOIN mail_destinations d ON d.message_id=m.id WHERE `+where+`
ORDER BY m.created_at DESC,m.id DESC LIMIT $6`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := make([]emailMessageItem, 0, limit+1)
	for rows.Next() {
		var item emailMessageItem
		var recipient string
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.UserID, &item.UserName, &recipient, &item.Kind, &item.Status, &item.ProviderMessageID, &item.FailureCode, &item.Attempts); err != nil {
			return err
		}
		item.RecipientMasked = maskEmail(recipient)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		v := encodeMailCursor(mailCursor{CreatedAt: items[len(items)-1].CreatedAt, ID: items[len(items)-1].ID})
		next = &v
	}
	jsonOut(w, http.StatusOK, map[string]any{"items": items, "next_cursor": next})
	return nil
}

func mailMessageStatus(s string) bool {
	switch s {
	case "queued", "accepted", "delivered", "deferred", "bounced", "failed", "suppressed", "cancelled", "unknown":
		return true
	default:
		return false
	}
}

func (a *App) emailMessageDetail(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var item emailMessageItem
	var recipient string
	err := a.DB.QueryRow(r.Context(), `SELECT m.id::text,m.created_at,m.user_id::text,u.name,d.recipient_snapshot,
m.kind,m.status,m.provider_message_id,m.failure_code,
(SELECT count(*) FROM mail_attempts x WHERE x.message_id=m.id)
FROM mail_messages m LEFT JOIN users u ON u.id=m.user_id JOIN mail_destinations d ON d.message_id=m.id WHERE m.id=$1`, id).Scan(
		&item.ID, &item.CreatedAt, &item.UserID, &item.UserName, &recipient, &item.Kind, &item.Status, &item.ProviderMessageID, &item.FailureCode, &item.Attempts)
	if err != nil {
		return err
	}
	item.RecipientMasked = maskEmail(recipient)
	type event struct {
		ID          string    `json:"id"`
		Status      string    `json:"status"`
		CreatedAt   time.Time `json:"created_at"`
		FailureCode *string   `json:"failure_code"`
	}
	events := make([]event, 0)
	rows, err := a.DB.Query(r.Context(), `SELECT id::text,status,COALESCE(finished_at,started_at),failure_code
FROM mail_attempts WHERE message_id=$1
UNION ALL
SELECT id::text,status,occurred_at,failure_code FROM mail_delivery_events WHERE message_id=$1
ORDER BY 3,id`, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.ID, &e.Status, &e.CreatedAt, &e.FailureCode); err != nil {
			return err
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, map[string]any{"message": item, "events": events})
	return nil
}

func (a *App) emailReconcile(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	if a.Mail == nil {
		return fail(503, "mail_unavailable", "E-Mail-Dienst nicht verfügbar.")
	}
	if err := a.Mail.reconcile(r.Context(), current(r).ID); err != nil {
		return err
	}
	out, err := a.Mail.status(r.Context())
	if err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, out)
	return nil
}

func (a *App) internalEmailLogin(w http.ResponseWriter, r *http.Request) error {
	secret := strings.TrimSpace(a.Config.AuthServiceSecret)
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if secret == "" || len(got) != len(secret) || subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
		return forbidden()
	}
	if a.Mail == nil {
		return fail(503, "mail_unavailable", "E-Mail-Dienst nicht verfügbar.")
	}
	var in struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		URL    string `json:"url"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if !validID(in.UserID) || !validMailAddress(in.Email) || !a.Mail.validateLoginURL(in.URL) {
		return bad("Ungültige interne E-Mail-Anfrage.")
	}
	var name, email string
	err := a.DB.QueryRow(r.Context(), `SELECT name,login_email FROM users
WHERE id=$1 AND admitted=true AND login_enabled=true`, in.UserID).Scan(&name, &email)
	if err == nil && strings.EqualFold(strings.TrimSpace(email), strings.TrimSpace(in.Email)) {
		if sendErr := a.Mail.sendLogin(r.Context(), in.UserID, name, email, in.URL); sendErr != nil {
			slog.Warn("login email delivery failed", "user_id", in.UserID, "failure_code", mailFailureCode(sendErr))
		}
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	// The auth service receives the same result for unknown, disabled, and
	// provider-failed addresses; no address or URL is echoed.
	jsonOut(w, http.StatusAccepted, map[string]bool{"ok": true})
	return nil
}

func (m *MailService) validateLoginURL(raw string) bool {
	if m == nil || m.config.PublicURL == "" || raw == "" || len(raw) > 8192 || strings.ContainsAny(raw, "\r\n\x00") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil {
		return false
	}
	base, err := url.Parse(strings.TrimRight(m.config.PublicURL, "/"))
	if err != nil || !strings.EqualFold(u.Scheme, base.Scheme) || !strings.EqualFold(u.Host, base.Host) || u.Path == "" {
		return false
	}
	return strings.HasPrefix(u.Path, "/auth/") || strings.HasPrefix(u.Path, "/api/auth/")
}

type mailSendRequest struct {
	UserID    string
	Category  *string
	JobID     string
	Kind      string
	Recipient string
	Name      string
	Subject   string
	Text      string
	HTML      string
	DedupKey  *string
}

type mailSendFailure struct {
	code      string
	uncertain bool
	retry     time.Duration
}

func (e *mailSendFailure) Error() string { return e.code }

func mailFailureCode(err error) string {
	var f *mailSendFailure
	if errors.As(err, &f) {
		return f.code
	}
	return "provider_unavailable"
}

func (m *MailService) sendLogin(ctx context.Context, userID, name, email, loginURL string) error {
	link := html.EscapeString(loginURL)
	_, err := m.send(ctx, mailSendRequest{
		UserID: userID, Kind: "login", Recipient: email, Name: name,
		Subject: "Dein Anmeldelink für AbiZeitBetrug",
		Text:    "Hier ist dein persönlicher Anmeldelink. Er ist nur kurze Zeit gültig:\n\n" + loginURL + "\n\nFalls du diese Anmeldung nicht angefordert hast, kannst du diese Nachricht ignorieren.",
		HTML:    "<p>Hier ist dein persönlicher Anmeldelink. Er ist nur kurze Zeit gültig:</p><p><a href=\"" + link + "\">Jetzt anmelden</a></p><p>Falls du diese Anmeldung nicht angefordert hast, kannst du diese Nachricht ignorieren.</p>",
	})
	return err
}

func (m *MailService) send(ctx context.Context, req mailSendRequest) (string, error) {
	if m == nil || m.db == nil {
		return "", &mailSendFailure{code: "provider_unavailable"}
	}
	if req.Kind != "login" && req.Kind != "reminder" || !validID(req.UserID) || !validMailAddress(req.Recipient) {
		return "", &mailSendFailure{code: "invalid_request"}
	}
	if err := m.ensurePolicy(ctx); err != nil {
		return "", err
	}
	id, attemptID, reservationID, err := m.reserve(ctx, req)
	if err != nil {
		return "", err
	}
	providerID, sendErr := m.deliver(ctx, req)
	finishCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if sendErr != nil {
		var failure *mailSendFailure
		if !errors.As(sendErr, &failure) {
			failure = &mailSendFailure{code: "provider_unavailable", uncertain: true}
		}
		state, attemptState, status := "released", "failed", "failed"
		if failure.uncertain {
			state, attemptState, status = "uncertain", "unknown", "unknown"
		}
		_, err = m.db.Exec(finishCtx, `UPDATE mail_reservations SET state=$2,updated_at=now() WHERE id=$1`, reservationID, state)
		if err == nil {
			_, err = m.db.Exec(finishCtx, `UPDATE mail_attempts SET status=$2,failure_code=$3,finished_at=now() WHERE id=$1`, attemptID, attemptState, failure.code)
		}
		if err == nil {
			_, err = m.db.Exec(finishCtx, `UPDATE mail_messages SET status=$2,failure_code=$3,updated_at=now() WHERE id=$1`, id, status, failure.code)
		}
		if err != nil {
			return id, err
		}
		return id, failure
	}
	if _, err = m.db.Exec(finishCtx, `UPDATE mail_reservations SET state='consumed',updated_at=now() WHERE id=$1`, reservationID); err != nil {
		return id, err
	}
	if _, err = m.db.Exec(finishCtx, `UPDATE mail_attempts SET status='accepted',provider_message_id=$2,finished_at=now() WHERE id=$1`, attemptID, providerID); err != nil {
		return id, err
	}
	_, err = m.db.Exec(finishCtx, `UPDATE mail_messages SET status='accepted',provider_message_id=$2,updated_at=now() WHERE id=$1`, id, providerID)
	return id, err
}

func (m *MailService) reserve(ctx context.Context, req mailSendRequest) (string, string, string, error) {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return "", "", "", err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(74120985)`); err != nil {
		return "", "", "", err
	}
	if err = validateReminderReservation(ctx, tx, req); err != nil {
		return "", "", "", err
	}
	if req.Kind == "login" {
		var eligible bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND admitted=true AND login_enabled=true
AND login_email IS NOT NULL AND lower(login_email)=lower($2))`, req.UserID, strings.TrimSpace(req.Recipient)).Scan(&eligible); err != nil {
			return "", "", "", err
		}
		if !eligible {
			return "", "", "", &mailSendFailure{code: "cancelled"}
		}
	}
	var p mailPolicy
	var providerCredits *int
	var providerObservedAt *time.Time
	if err = tx.QueryRow(ctx, `SELECT version,paused,pause_all,LEAST(daily_limit,$1),LEAST(reminder_limit,$2),LEAST(login_reserve,$3)
 ,provider_credits,provider_observed_at FROM mail_policy WHERE id=1 FOR UPDATE`, m.config.DailyLimit, m.config.ReminderLimit, m.config.LoginReserve).Scan(
		&p.Version, &p.Paused, &p.PauseAll, &p.DailyLimit, &p.ReminderLimit, &p.LoginReserve, &providerCredits, &providerObservedAt); err != nil {
		return "", "", "", err
	}
	if p.PauseAll || req.Kind == "reminder" && p.Paused {
		return "", "", "", &mailSendFailure{code: "paused"}
	}
	day := time.Now().UTC().Format("2006-01-02")
	var used, reserved, reminderUsed, reminderReserved int
	err = tx.QueryRow(ctx, `SELECT
count(*) FILTER (WHERE state='consumed'),
count(*) FILTER (WHERE state IN ('reserved','uncertain')),
count(*) FILTER (WHERE kind='reminder' AND state='consumed'),
count(*) FILTER (WHERE kind='reminder' AND state IN ('reserved','uncertain'))
FROM mail_reservations WHERE quota_day=$1::date`, day).Scan(&used, &reserved, &reminderUsed, &reminderReserved)
	if err != nil {
		return "", "", "", err
	}
	if m.config.Provider == "brevo" && providerCredits != nil && providerObservedAt != nil && providerObservedAt.After(time.Now().UTC().Add(-90*24*time.Hour)) {
		var acceptedAfterObservation, unsettled int
		if err = tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE state='consumed' AND updated_at>$1),
count(*) FILTER (WHERE state IN ('reserved','uncertain')) FROM mail_reservations`, *providerObservedAt).Scan(&acceptedAfterObservation, &unsettled); err != nil {
			return "", "", "", err
		}
		if acceptedAfterObservation+unsettled >= *providerCredits {
			return "", "", "", &mailSendFailure{code: "quota_exhausted"}
		}
	}
	if used+reserved >= p.DailyLimit || req.Kind == "reminder" && (reminderUsed+reminderReserved >= p.ReminderLimit || used+reserved+1 > p.DailyLimit-p.LoginReserve) {
		return "", "", "", &mailSendFailure{code: "quota_exhausted"}
	}
	id, attemptID, reservationID := ID(), ID(), ID()
	var category any
	if req.Category != nil {
		category = *req.Category
	}
	var dedup any
	if req.DedupKey != nil {
		dedup = *req.DedupKey
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mail_messages(id,user_id,category_id,kind,status,dedup_key)
VALUES($1,$2,$3,$4,'queued',$5)`, id, req.UserID, category, req.Kind, dedup); err != nil {
		return "", "", "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mail_destinations(message_id,recipient_snapshot) VALUES($1,$2)`, id, strings.TrimSpace(req.Recipient)); err != nil {
		return "", "", "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mail_attempts(id,message_id,attempt_number,status) VALUES($1,$2,1,'started')`, attemptID, id); err != nil {
		return "", "", "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mail_reservations(id,message_id,attempt_id,quota_day,kind,state)
VALUES($1,$2,$3,$4::date,$5,'reserved')`, reservationID, id, attemptID, day, req.Kind); err != nil {
		return "", "", "", err
	}
	if req.JobID != "" {
		if _, err = tx.Exec(ctx, `UPDATE mail_reminder_jobs SET last_message_id=$2,updated_at=now() WHERE id=$1 AND status='leased'`, req.JobID, id); err != nil {
			return "", "", "", err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", "", err
	}
	return id, attemptID, reservationID, nil
}

func (m *MailService) deliver(ctx context.Context, req mailSendRequest) (string, error) {
	if m.config.Provider == "capture" {
		return "local-" + ID(), nil
	}
	if !m.config.TrackingDisabled {
		return "", &mailSendFailure{code: "provider_rejected"}
	}
	from, _ := mail.ParseAddress(m.config.From)
	toName := strings.TrimSpace(req.Name)
	if toName == "" {
		toName = strings.TrimSpace(req.Recipient)
	}
	body := map[string]any{
		"sender":      map[string]string{"name": from.Name, "email": from.Address},
		"to":          []map[string]any{{"name": toName, "email": strings.TrimSpace(req.Recipient), "contactPixelTrackingConsent": false}},
		"subject":     req.Subject,
		"textContent": req.Text,
		"htmlContent": req.HTML,
	}
	if m.config.ReplyTo != "" {
		reply, _ := mail.ParseAddress(m.config.ReplyTo)
		body["replyTo"] = map[string]string{"name": reply.Name, "email": reply.Address}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", &mailSendFailure{code: "invalid_request"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, m.config.BaseURL+"/smtp/email", bytes.NewReader(encoded))
	if err != nil {
		return "", &mailSendFailure{code: "invalid_request"}
	}
	request.Header.Set("api-key", m.config.APIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := m.client.Do(request)
	if err != nil {
		return "", &mailSendFailure{code: "provider_unavailable", uncertain: true}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return "", &mailSendFailure{code: "rate_limited", retry: retryAfter(response.Header.Get("Retry-After"))}
	}
	if response.StatusCode >= 500 {
		return "", &mailSendFailure{code: "provider_unavailable", uncertain: true}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &mailSendFailure{code: "provider_rejected"}
	}
	var result struct {
		MessageID string `json:"messageId"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result); err != nil || result.MessageID == "" || len(result.MessageID) > 256 || strings.ContainsAny(result.MessageID, "\r\n\x00") {
		// A successful response without a usable identifier may already have
		// accepted the email, so its quota reservation stays conservative.
		return "", &mailSendFailure{code: "provider_unavailable", uncertain: true}
	}
	return result.MessageID, nil
}

func retryAfter(value string) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
		if seconds > 0 && seconds < int((24*time.Hour)/time.Second) {
			return time.Duration(seconds) * time.Second
		}
	}
	if at, err := http.ParseTime(value); err == nil {
		if wait := time.Until(at); wait > 0 && wait < 24*time.Hour {
			return wait
		}
	}
	return time.Hour
}

func (m *MailService) reconcile(ctx context.Context, actorID string) error {
	if err := m.ensurePolicy(ctx); err != nil {
		return err
	}
	started := time.Now().UTC()
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var last *time.Time
	if err := tx.QueryRow(ctx, `SELECT last_reconcile_at FROM mail_policy WHERE id=1 FOR UPDATE`).Scan(&last); err != nil {
		return err
	}
	if last != nil && started.Sub(*last) < time.Minute {
		return fail(429, "reconcile_cooldown", "Eine erneute Abfrage ist in einer Minute möglich.")
	}
	if _, err := tx.Exec(ctx, `UPDATE mail_policy SET last_reconcile_at=$1 WHERE id=1`, started); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	providerErr := (*string)(nil)
	var credits *int
	observedAt := any(nil)
	refreshProviderObservation := m.config.Provider == "capture"
	if m.config.Provider == "brevo" {
		account, err := m.providerGet(ctx, "/account", nil)
		if err != nil {
			code := providerFailureState(err)
			providerErr = &code
		} else {
			credits = parseBrevoEmailCredits(account)
			observedAt = started
			refreshProviderObservation = true
			if err := m.reconcileDeliveryEvents(ctx, started.Add(-48*time.Hour), started); err != nil {
				code := providerFailureState(err)
				providerErr = &code
			}
		}
	}
	_, err = m.db.Exec(ctx, `UPDATE mail_policy SET provider_observed_at=CASE WHEN $3 THEN $1 ELSE COALESCE($1,provider_observed_at) END,
provider_error=$2,provider_credits=CASE WHEN $3 THEN $4 ELSE provider_credits END WHERE id=1`, observedAt, providerErr, refreshProviderObservation, credits)
	if err != nil {
		return err
	}
	if _, err = m.db.Exec(ctx, `INSERT INTO mail_admin_events(id,actor_id,action,details) VALUES($1,$2,'reconciled','{}'::jsonb)`, ID(), actorID); err != nil {
		return err
	}
	if _, err = m.db.Exec(ctx, `INSERT INTO audit_events(id,actor_id,action,entity_id) VALUES($1,$2,'email.reconciled',$3)`, ID(), actorID, mailAdminEntityID); err != nil {
		return err
	}
	return nil
}

func providerFailureState(err error) string {
	var f *mailSendFailure
	if errors.As(err, &f) && f.code == "rate_limited" {
		return "rate_limited"
	}
	if errors.As(err, &f) && f.code == "provider_rejected" {
		return "provider_error"
	}
	return "unavailable"
}

func parseBrevoEmailCredits(body []byte) *int {
	var account struct {
		Plan []struct {
			Credits     json.RawMessage `json:"credits"`
			CreditsType string          `json:"creditsType"`
			Type        string          `json:"type"`
		} `json:"plan"`
	}
	if json.Unmarshal(body, &account) != nil {
		return nil
	}
	var found *int
	candidates := 0
	for _, plan := range account.Plan {
		if !strings.EqualFold(strings.TrimSpace(plan.CreditsType), "sendLimit") {
			continue
		}
		typeName := strings.ToLower(strings.TrimSpace(plan.Type))
		if typeName == "sms" {
			continue
		}
		switch typeName {
		case "free", "subscription", "payg", "pay-as-you-go", "pay as you go", "payasyougo":
		default:
			return nil
		}
		candidates++
		var value int
		if json.Unmarshal(plan.Credits, &value) != nil || value < 0 {
			return nil
		}
		found = &value
	}
	if candidates != 1 {
		return nil
	}
	return found
}

func (m *MailService) providerGet(ctx context.Context, path string, query url.Values) ([]byte, error) {
	endpoint := m.config.BaseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, &mailSendFailure{code: "invalid_request"}
	}
	request.Header.Set("api-key", m.config.APIKey)
	request.Header.Set("Accept", "application/json")
	response, err := m.client.Do(request)
	if err != nil {
		return nil, &mailSendFailure{code: "provider_unavailable", uncertain: true}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return nil, &mailSendFailure{code: "rate_limited"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &mailSendFailure{code: "provider_rejected"}
	}
	b, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, &mailSendFailure{code: "provider_unavailable"}
	}
	return b, nil
}

func (m *MailService) reconcileDeliveryEvents(ctx context.Context, from, to time.Time) error {
	const pageSize, maxPages = 500, 20
	for page := 0; page < maxPages; page++ {
		query := url.Values{}
		query.Set("limit", strconv.Itoa(pageSize))
		query.Set("offset", strconv.Itoa(page*pageSize))
		query.Set("startDate", from.UTC().Format("2006-01-02"))
		query.Set("endDate", to.UTC().Format("2006-01-02"))
		b, err := m.providerGet(ctx, "/smtp/statistics/events", query)
		if err != nil {
			return err
		}
		var response struct {
			Events []struct {
				MessageID string `json:"messageId"`
				Event     string `json:"event"`
				Time      int64  `json:"ts_event"`
				Date      string `json:"date"`
			} `json:"events"`
		}
		if json.Unmarshal(b, &response) != nil {
			return &mailSendFailure{code: "provider_unavailable"}
		}
		for _, item := range response.Events {
			if item.MessageID == "" || len(item.MessageID) > 256 || strings.ContainsAny(item.MessageID, "\r\n\x00") {
				continue
			}
			status, failureCode, ok := mapProviderEvent(item.Event)
			if !ok {
				continue
			}
			var messageID string
			err := m.db.QueryRow(ctx, `SELECT id::text FROM mail_messages WHERE provider_message_id=$1`, item.MessageID).Scan(&messageID)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			var occurred time.Time
			if item.Time > 0 {
				occurred = time.Unix(item.Time, 0).UTC()
			} else {
				occurred, err = time.Parse(time.RFC3339Nano, item.Date)
				if err != nil {
					continue
				}
				occurred = occurred.UTC()
			}
			digest := sha256.Sum256([]byte(item.MessageID + "\x00" + item.Event + "\x00" + occurred.Format(time.RFC3339Nano)))
			dedup := hex.EncodeToString(digest[:])
			tx, err := m.db.Begin(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `INSERT INTO mail_delivery_events(id,message_id,dedup_key,status,failure_code,occurred_at)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedup_key) DO NOTHING`, ID(), messageID, dedup, status, failureCode, occurred)
			if err == nil {
				// A later delivery fact can advance accepted/deferred states, while a
				// duplicate or older event cannot regress a terminal state.
				_, err = tx.Exec(ctx, `UPDATE mail_messages SET status=$2,failure_code=$3,updated_at=now()
WHERE id=$1 AND status IN ('accepted','deferred','unknown') AND
($2='delivered' OR $2 IN ('bounced','suppressed','failed') OR $2='deferred' AND status='accepted')`, messageID, status, failureCode)
			}
			if err == nil {
				err = tx.Commit(ctx)
			} else {
				_ = tx.Rollback(ctx)
			}
			if err != nil {
				return err
			}
		}
		if len(response.Events) < pageSize {
			return nil
		}
	}
	// Do not report reconciliation success after hitting the bounded page cap.
	return &mailSendFailure{code: "provider_unavailable"}
}

func mapProviderEvent(event string) (status string, failure *string, ok bool) {
	switch strings.ToLower(event) {
	case "delivered":
		return "delivered", nil, true
	case "deferred", "softbounce":
		v := "deferred"
		return "deferred", &v, true
	case "hardbounce", "invalid_email":
		v := "bounce"
		return "bounced", &v, true
	case "blocked", "spam", "complaint", "unsubscribed":
		v := "suppressed"
		return "suppressed", &v, true
	case "error":
		v := "provider_rejected"
		return "failed", &v, true
	default:
		return "", nil, false
	}
}

// Keep a compile-time reference to pgx so scanner errors remain explicit in
// the internal endpoint rather than being translated to account-existence data.
var _ = pgx.ErrNoRows
