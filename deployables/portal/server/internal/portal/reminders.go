package portal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const reminderCandidateSQL = `
SELECT u.id::text,c.id::text,c.closes_at,
       CASE WHEN c.closes_at <= now()+interval '24 hours' THEN 24 ELSE 72 END::smallint AS milestone
FROM categories c
JOIN users u ON u.admitted=true AND u.cohort_member=true AND u.login_enabled=true
 AND u.email_reminders_enabled=true AND u.login_email IS NOT NULL AND btrim(u.login_email)<>''
WHERE c.email_reminders_enabled=true AND c.status='open' AND c.ongoing=false
  AND c.closes_at>now() AND c.closes_at<=now()+interval '72 hours'
  AND ((c.kind IN ('person','proposal','words') AND NOT EXISTS (
         SELECT 1 FROM ballots b WHERE b.poll_id=c.id AND b.user_id=u.id))
    OR (c.kind IN ('idea','quote','memory','photo') AND c.repeatable=false AND NOT EXISTS (
         SELECT 1 FROM submissions s WHERE s.category_id=c.id AND s.author_id=u.id AND s.status<>'withdrawn')))
  AND NOT EXISTS (
      SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
       WHERE m.kind='reminder' AND m.user_id=u.id AND m.category_id=c.id
       AND lower(d.recipient_snapshot)=lower(u.login_email) AND m.status IN ('accepted','delivered','deferred','unknown')
       AND m.created_at>now()-interval '24 hours')
  AND NOT EXISTS (
      SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
       WHERE m.user_id=u.id
       AND lower(d.recipient_snapshot)=lower(u.login_email)
       AND (m.status IN ('bounced','suppressed') OR EXISTS (
          SELECT 1 FROM mail_delivery_events e WHERE e.message_id=m.id AND e.status IN ('bounced','suppressed'))))
`

type reminderCandidate struct {
	UserID    string
	Category  string
	ClosesAt  time.Time
	Milestone int
}

func (m *MailService) reminderCandidates(ctx context.Context) ([]reminderCandidate, error) {
	rows, err := m.db.Query(ctx, reminderCandidateSQL+` ORDER BY c.closes_at,c.id,u.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]reminderCandidate, 0)
	for rows.Next() {
		var candidate reminderCandidate
		if err := rows.Scan(&candidate.UserID, &candidate.Category, &candidate.ClosesAt, &candidate.Milestone); err != nil {
			return nil, err
		}
		out = append(out, candidate)
	}
	return out, rows.Err()
}

func (m *MailService) previewReminders(ctx context.Context) (int, error) {
	var count int
	err := m.db.QueryRow(ctx, `SELECT count(*) FROM (`+reminderCandidateSQL+`) eligible`).Scan(&count)
	return count, err
}

func (a *App) emailReminderPreview(w http.ResponseWriter, r *http.Request) error {
	if err := a.requireMailAdmin(r); err != nil {
		return err
	}
	if a.Mail == nil {
		return fail(503, "mail_unavailable", "E-Mail-Dienst nicht verfügbar.")
	}
	count, err := a.Mail.previewReminders(r.Context())
	if err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, map[string]int{"eligible": count})
	return nil
}

// emailReminderPreference is wired by the lead as PATCH /api/v1/me/email-reminders.
// It is intentionally independent from login delivery.
func (a *App) emailReminderPreference(w http.ResponseWriter, r *http.Request) error {
	user := current(r)
	if r.Method == http.MethodGet {
		var enabled bool
		if err := a.DB.QueryRow(r.Context(), `SELECT email_reminders_enabled FROM users WHERE id=$1`, user.ID).Scan(&enabled); err != nil {
			return err
		}
		jsonOut(w, http.StatusOK, map[string]bool{"enabled": enabled})
		return nil
	}
	var in struct {
		Enabled bool `json:"enabled"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if _, err := a.DB.Exec(r.Context(), `UPDATE users SET email_reminders_enabled=$2 WHERE id=$1`, user.ID, in.Enabled); err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, map[string]bool{"enabled": in.Enabled})
	return nil
}

// RunReminders runs one immediate scan when once is true, or scans now and then
// hourly until the context is cancelled. The scheduler is explicitly disabled
// by default even though admin previews remain available.
func (m *MailService) RunReminders(ctx context.Context, once bool) error {
	if once {
		return m.runReminderCycle(ctx)
	}
	_ = m.runReminderCycle(ctx)
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.runReminderCycle(ctx); err != nil && ctx.Err() == nil {
				// An hourly worker should survive a transient database/provider
				// error; the next tick re-evaluates from persisted state.
				continue
			}
		}
	}
}

func (m *MailService) runReminderCycle(ctx context.Context) error {
	if err := m.ensurePolicy(ctx); err != nil {
		return err
	}
	if _, err := m.db.Exec(ctx, `UPDATE mail_policy SET last_worker_run=now() WHERE id=1`); err != nil {
		return err
	}
	if err := m.pruneHistory(ctx); err != nil {
		return err
	}
	if !m.config.RemindersEnabled {
		return nil
	}
	p, err := m.effectivePolicy(ctx)
	if err != nil {
		return err
	}
	if p.Paused || p.PauseAll {
		return nil
	}
	candidates, err := m.reminderCandidates(ctx)
	if err != nil {
		return err
	}
	for _, c := range candidates {
		key := reminderKey(c)
		if _, err := m.db.Exec(ctx, `INSERT INTO mail_reminder_jobs(id,user_id,category_id,closes_at,milestone,dedup_key)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ID(), c.UserID, c.Category, c.ClosesAt, c.Milestone, key); err != nil {
			return err
		}
	}
	// Expired leases may have reached the provider before a worker died. They
	// become uncertain and are never automatically re-sent.
	if _, err := m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='uncertain',failure_code='unknown',lease_until=NULL,updated_at=now()
WHERE status='leased' AND lease_until<now()`); err != nil {
		return err
	}
	if _, err := m.db.Exec(ctx, `UPDATE mail_reservations r SET state='uncertain',updated_at=now()
FROM mail_reminder_jobs j WHERE j.last_message_id=r.message_id AND j.status='uncertain' AND r.state='reserved'`); err != nil {
		return err
	}
	if _, err := m.db.Exec(ctx, `UPDATE mail_attempts a SET status='unknown',failure_code='unknown',finished_at=now()
FROM mail_reminder_jobs j WHERE j.last_message_id=a.message_id AND j.status='uncertain' AND a.status='started'`); err != nil {
		return err
	}
	if _, err := m.db.Exec(ctx, `UPDATE mail_messages m SET status='unknown',failure_code='unknown',updated_at=now()
FROM mail_reminder_jobs j WHERE j.last_message_id=m.id AND j.status='uncertain' AND m.status='queued'`); err != nil {
		return err
	}
	for i := 0; i < 100; i++ {
		id, err := m.leaseReminder(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := m.dispatchReminder(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func reminderKey(c reminderCandidate) string {
	input := c.UserID + "\x00" + c.Category + "\x00" + c.ClosesAt.UTC().Format(time.RFC3339Nano) + "\x00" + fmt.Sprint(c.Milestone)
	h := sha256.Sum256([]byte(input))
	return hex.EncodeToString(h[:])
}

func (m *MailService) leaseReminder(ctx context.Context) (string, error) {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `SELECT id::text FROM mail_reminder_jobs
WHERE status='queued' AND not_before<=now() ORDER BY not_before,created_at,id
LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id)
	if err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `UPDATE mail_reminder_jobs SET status='leased',lease_until=now()+interval '15 minutes',updated_at=now() WHERE id=$1`, id); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

type reminderDetails struct {
	UserID       string
	Category     string
	ClosesAt     time.Time
	Milestone    int
	Email        string
	CategoryName string
}

func (m *MailService) recheckReminder(ctx context.Context, jobID string) (reminderDetails, error) {
	var d reminderDetails
	err := m.db.QueryRow(ctx, `SELECT j.user_id::text,j.category_id::text,j.closes_at,j.milestone,u.login_email,c.name
FROM mail_reminder_jobs j
JOIN users u ON u.id=j.user_id
JOIN categories c ON c.id=j.category_id
WHERE j.id=$1 AND j.status='leased' AND j.lease_until>now()
 AND u.admitted=true AND u.cohort_member=true AND u.login_enabled=true
 AND u.email_reminders_enabled=true AND u.login_email IS NOT NULL AND btrim(u.login_email)<>''
 AND c.email_reminders_enabled=true AND c.status='open' AND c.ongoing=false
 AND c.closes_at=j.closes_at AND c.closes_at>now() AND c.closes_at<=now()+interval '72 hours'
 AND (CASE WHEN c.closes_at<=now()+interval '24 hours' THEN 24 ELSE 72 END)=j.milestone
 AND ((c.kind IN ('person','proposal','words') AND NOT EXISTS (
        SELECT 1 FROM ballots b WHERE b.poll_id=c.id AND b.user_id=u.id))
   OR (c.kind IN ('idea','quote','memory','photo') AND c.repeatable=false AND NOT EXISTS (
        SELECT 1 FROM submissions s WHERE s.category_id=c.id AND s.author_id=u.id AND s.status<>'withdrawn')))
 AND NOT EXISTS (
      SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
       WHERE m.kind='reminder' AND m.user_id=u.id AND m.category_id=c.id
       AND lower(d.recipient_snapshot)=lower(u.login_email) AND m.status IN ('accepted','delivered','deferred','unknown')
       AND m.created_at>now()-interval '24 hours')
 AND NOT EXISTS (
      SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
       WHERE m.user_id=u.id
       AND lower(d.recipient_snapshot)=lower(u.login_email)
       AND (m.status IN ('bounced','suppressed') OR EXISTS (
          SELECT 1 FROM mail_delivery_events e WHERE e.message_id=m.id AND e.status IN ('bounced','suppressed'))))`, jobID).Scan(
		&d.UserID, &d.Category, &d.ClosesAt, &d.Milestone, &d.Email, &d.CategoryName)
	return d, err
}

func (m *MailService) dispatchReminder(ctx context.Context, jobID string) error {
	d, err := m.recheckReminder(ctx, jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		_, updateErr := m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='cancelled',failure_code='cancelled',lease_until=NULL,updated_at=now() WHERE id=$1 AND status='leased'`, jobID)
		return updateErr
	}
	if err != nil {
		return err
	}
	deadline := d.ClosesAt
	if loc, e := time.LoadLocation("Europe/Berlin"); e == nil {
		deadline = deadline.In(loc)
	}
	date := deadline.Format("02.01.2006 um 15:04 Uhr")
	portalURL := strings.TrimRight(m.config.PublicURL, "/") + "/"
	category := strings.TrimSpace(d.CategoryName)
	text := fmt.Sprintf("Die Sammlung %q schließt am %s. Falls du noch teilnehmen möchtest, findest du sie im AbiZeitBetrug-Portal:\n%s", category, date, portalURL)
	htmlBody := fmt.Sprintf("<p>Die Sammlung <strong>%s</strong> schließt am %s.</p><p>Falls du noch teilnehmen möchtest, findest du sie im <a href=\"%s\">AbiZeitBetrug-Portal</a>.</p>", html.EscapeString(category), html.EscapeString(date), html.EscapeString(portalURL))
	messageID, sendErr := m.send(ctx, mailSendRequest{
		UserID: d.UserID, Category: &d.Category, JobID: jobID, Kind: "reminder", Recipient: d.Email,
		Subject: "Erinnerung: eine Sammlung schließt bald",
		Text:    text, HTML: htmlBody,
	})
	if sendErr == nil {
		_, err = m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='sent',last_message_id=$2,failure_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, jobID, messageID)
		return err
	}
	var failure *mailSendFailure
	if !errors.As(sendErr, &failure) {
		failure = &mailSendFailure{code: "provider_unavailable", uncertain: true}
	}
	if failure.uncertain {
		_, err = m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='uncertain',last_message_id=NULLIF($2,'')::uuid,failure_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1`, jobID, messageID, failure.code)
		return err
	}
	if failure.code == "cancelled" {
		_, err = m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='cancelled',last_message_id=NULLIF($2,'')::uuid,failure_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1`, jobID, messageID, failure.code)
		return err
	}
	if failure.code == "rate_limited" || failure.code == "quota_exhausted" || failure.code == "paused" || failure.code == "provider_unavailable" {
		retry := failure.retry
		if retry <= 0 {
			retry = time.Hour
		}
		_, err = m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='queued',last_message_id=NULLIF($2,'')::uuid,failure_code=$3,not_before=now()+$4::interval,lease_until=NULL,updated_at=now() WHERE id=$1`, jobID, messageID, failure.code, retry.String())
		return err
	}
	_, err = m.db.Exec(ctx, `UPDATE mail_reminder_jobs SET status='failed',last_message_id=NULLIF($2,'')::uuid,failure_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1`, jobID, messageID, failure.code)
	return err
}

func (m *MailService) pruneHistory(ctx context.Context) error {
	var last *time.Time
	if err := m.db.QueryRow(ctx, `SELECT last_prune_at FROM mail_policy WHERE id=1`).Scan(&last); err != nil {
		return err
	}
	if last != nil && time.Since(*last) < 24*time.Hour {
		return nil
	}
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var locked *time.Time
	if err = tx.QueryRow(ctx, `SELECT last_prune_at FROM mail_policy WHERE id=1 FOR UPDATE`).Scan(&locked); err != nil {
		return err
	}
	if locked != nil && time.Since(*locked) < 24*time.Hour {
		return tx.Commit(ctx)
	}
	cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour)
	if _, err = tx.Exec(ctx, `DELETE FROM mail_reminder_jobs WHERE created_at<$1`, cutoff); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM mail_messages WHERE created_at<$1`, cutoff); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM mail_admin_events WHERE created_at<$1`, cutoff); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mail_policy SET last_prune_at=now() WHERE id=1`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var reminderReadySQL = `SELECT EXISTS (
 SELECT 1 FROM mail_reminder_jobs j JOIN users u ON u.id=j.user_id JOIN categories c ON c.id=j.category_id
 WHERE j.id=$1 AND j.status='leased' AND j.lease_until>now()
  AND u.id=$2 AND c.id=$3 AND lower(u.login_email)=lower($4)
  AND u.admitted=true AND u.cohort_member=true AND u.login_enabled=true AND u.email_reminders_enabled=true
  AND c.email_reminders_enabled=true AND c.status='open' AND c.ongoing=false AND c.closes_at=j.closes_at
  AND c.closes_at>now() AND c.closes_at<=now()+interval '72 hours'
  AND (CASE WHEN c.closes_at<=now()+interval '24 hours' THEN 24 ELSE 72 END)=j.milestone
  AND ((c.kind IN ('person','proposal','words') AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.poll_id=c.id AND b.user_id=u.id))
    OR (c.kind IN ('idea','quote','memory','photo') AND c.repeatable=false AND NOT EXISTS
        (SELECT 1 FROM submissions s WHERE s.category_id=c.id AND s.author_id=u.id AND s.status<>'withdrawn')))
  AND NOT EXISTS (SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
    WHERE m.kind='reminder' AND m.user_id=u.id AND m.category_id=c.id AND lower(d.recipient_snapshot)=lower(u.login_email)
      AND m.status IN ('accepted','delivered','deferred','unknown') AND m.created_at>now()-interval '24 hours')
  AND NOT EXISTS (SELECT 1 FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
    WHERE m.user_id=u.id AND lower(d.recipient_snapshot)=lower(u.login_email)
      AND (m.status IN ('bounced','suppressed') OR EXISTS
        (SELECT 1 FROM mail_delivery_events e WHERE e.message_id=m.id AND e.status IN ('bounced','suppressed'))))
)`

func validateReminderReservation(ctx context.Context, tx pgx.Tx, req mailSendRequest) error {
	if req.JobID == "" {
		return nil
	}
	var ready bool
	if err := tx.QueryRow(ctx, reminderReadySQL, req.JobID, req.UserID, valueOrEmpty(req.Category), req.Recipient).Scan(&ready); err != nil {
		return err
	}
	if !ready {
		return &mailSendFailure{code: "cancelled"}
	}
	return nil
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// RunReminderCommand is the CLI adapter used by `portal reminders`. Without
// flags it runs the hourly worker; --once runs one real cycle and --dry-run
// prints only an aggregate preview. Collection opt-in changes are a no-op
// unless --apply is also present.
func RunReminderCommand(ctx context.Context, pool *pgxpool.Pool, config MailConfig, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("reminders", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	once := flags.Bool("once", false, "run one cycle")
	dryRun := flags.Bool("dry-run", false, "preview aggregate count")
	categoryID := flags.String("category", "", "collection UUID to configure")
	enabledRaw := flags.String("enabled", "", "collection reminder opt-in")
	apply := flags.Bool("apply", false, "apply the requested collection setting")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return errors.New("invalid reminders arguments")
	}
	service := NewMailService(pool, config)
	if *categoryID != "" || *enabledRaw != "" || *apply {
		if *categoryID == "" || *enabledRaw == "" || *once || *dryRun {
			return errors.New("configure reminders with --category UUID --enabled=true|false [--apply]")
		}
		if !validID(*categoryID) {
			return errors.New("category must be a UUID")
		}
		enabled, err := strconv.ParseBool(*enabledRaw)
		if err != nil {
			return errors.New("--enabled must be true or false")
		}
		if !*apply {
			_, err = fmt.Fprintf(out, "Would set collection %s email reminders to %t; pass --apply to save.\n", *categoryID, enabled)
			return err
		}
		result, err := pool.Exec(ctx, `UPDATE categories SET email_reminders_enabled=$2,version=version+1 WHERE id=$1`, *categoryID, enabled)
		if err != nil {
			return err
		}
		if result.RowsAffected() != 1 {
			return errors.New("collection not found")
		}
		_, err = fmt.Fprintf(out, "Collection %s email reminders set to %t.\n", *categoryID, enabled)
		return err
	}
	if *dryRun {
		count, err := service.previewReminders(ctx)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(out, "Eligible reminder count: %d\n", count)
		return err
	}
	if err := service.RunReminders(ctx, *once); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}
