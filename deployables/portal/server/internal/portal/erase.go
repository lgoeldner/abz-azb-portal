package portal

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const erasedName = "Gelöschte Person"

// RunEraseCommand handles a GDPR erasure request in one command: `portal erase --id <uuid> [--apply]`.
// It deletes the person's own contributions (with image files), corrections, votes, person-poll options about them
// (including other people's votes for them), sessions, credentials and stored addresses. The user row stays as an
// identity-free tombstone, so team records (tickets, edits on other people's contributions, audit) keep their references.
// Without --apply everything rolls back and no file is touched. Backups keep the data until their snapshots expire.
func RunEraseCommand(ctx context.Context, pool *pgxpool.Pool, c Config, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("erase", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var id string
	var apply bool
	fs.StringVar(&id, "id", "", "user UUID")
	fs.BoolVar(&apply, "apply", false, "commit changes and remove files")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || !validID(id) {
		return errors.New("usage: portal erase --id <user UUID> [--apply]")
	}
	if apply {
		// Hold the backup lock before taking any database lock, so a running backup never pairs a pre-erase dump with
		// post-erase uploads and identity changes are not blocked while waiting for it.
		unlock, err := lockBackup(c.BackupStatusFile)
		if err != nil {
			return err
		}
		defer unlock()
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return errors.New("cannot start erase transaction")
	}
	defer tx.Rollback(ctx)
	counts, keys, err := eraseUser(ctx, tx, id)
	if err != nil {
		return err
	}
	removed, failed := 0, []string(nil)
	if apply {
		if err = tx.Commit(ctx); err != nil {
			return errors.New("erasure could not be committed")
		}
		for _, key := range keys {
			if e := os.Remove(filepath.Join(c.UploadDir, filepath.Clean("/"+key))); e == nil || errors.Is(e, os.ErrNotExist) {
				removed++
			} else {
				failed = append(failed, key)
			}
		}
	}
	counts["files_removed"] = removed
	if err = json.NewEncoder(out).Encode(struct {
		Applied bool           `json:"applied"`
		UserID  string         `json:"user_id"`
		Counts  map[string]int `json:"counts"`
		// Storage keys are random names, not personal data; listed so an operator can delete them by hand.
		FailedFiles []string `json:"failed_files,omitempty"`
	}{apply, id, counts, failed}); err != nil {
		return err
	}
	if len(failed) > 0 {
		return errors.New("erasure committed, but some upload files could not be removed; delete failed_files from UPLOAD_DIR manually")
	}
	return nil
}

func eraseUser(ctx context.Context, tx pgx.Tx, id string) (map[string]int, []string, error) {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120984)"); err != nil {
		return nil, nil, errors.New("cannot lock user transaction")
	}
	var name string
	var erased bool
	if err := tx.QueryRow(ctx, "SELECT name, erased_at IS NOT NULL FROM users WHERE id=$1 FOR UPDATE", id).Scan(&name, &erased); err != nil {
		return nil, nil, errors.New("unknown user")
	}
	if erased {
		return nil, nil, errors.New("user is already erased")
	}
	var keys []string
	rows, err := tx.Query(ctx, "SELECT a.storage_key, a.preview_key FROM attachments a JOIN submissions s ON s.id=a.submission_id WHERE s.author_id=$1", id)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var k, p string
		if err = rows.Scan(&k, &p); err != nil {
			rows.Close()
			return nil, nil, err
		}
		keys = append(keys, k, p)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, nil, err
	}
	own := "SELECT id FROM submissions WHERE author_id=$1"
	about := "SELECT id FROM poll_options WHERE user_id=$1"
	steps := []struct{ key, sql string }{
		{"corrections", "DELETE FROM corrections WHERE author_id=$1 OR submission_id IN (" + own + ")"},
		{"", "DELETE FROM revisions WHERE submission_id IN (" + own + ")"},
		{"attachments", "DELETE FROM attachments WHERE submission_id IN (" + own + ")"},
		{"submissions", "DELETE FROM submissions WHERE author_id=$1"},
		{"ballots", "DELETE FROM ballots WHERE user_id=$1 OR option_id IN (" + about + ")"},
		{"ballot_history", "DELETE FROM ballot_audit WHERE user_id=$1 OR option_id IN (" + about + ")"},
		{"person_options", "DELETE FROM poll_options WHERE user_id=$1"},
		// Free-text words nobody else chose would otherwise remain as anonymous leftovers of this person's input.
		{"words", "DELETE FROM poll_options o USING categories c WHERE o.poll_id=c.id AND c.kind='words' AND NOT EXISTS(SELECT 1 FROM ballots b WHERE b.option_id=o.id) AND NOT EXISTS(SELECT 1 FROM ballot_audit h WHERE h.option_id=o.id)"},
		{"", "DELETE FROM area_reviewers WHERE user_id=$1"},
		{"", "DELETE FROM consents WHERE user_id=$1"},
		{"", "DELETE FROM mail_reminder_jobs WHERE user_id=$1"},
		{"mail_addresses", "DELETE FROM mail_destinations WHERE message_id IN (SELECT id FROM mail_messages WHERE user_id=$1)"},
		{"", "UPDATE mail_messages SET user_id=NULL WHERE user_id=$1"},
		{"", "DELETE FROM auth_verifications WHERE CASE WHEN value IS JSON OBJECT THEN lower(value::jsonb->>'email')=(SELECT login_email FROM users WHERE id=$1) ELSE false END"},
		{"", "DELETE FROM auth_accounts WHERE user_id=$1"},
		{"", "DELETE FROM auth_sessions WHERE user_id=$1"},
		{"", "DELETE FROM sessions WHERE user_id=$1"},
	}
	counts := map[string]int{}
	for _, s := range steps {
		args := []any{id}
		if !strings.Contains(s.sql, "$1") {
			args = nil
		}
		tag, err := tx.Exec(ctx, s.sql, args...)
		if err != nil {
			return nil, nil, err
		}
		if s.key != "" {
			counts[s.key] = int(tag.RowsAffected())
		}
	}
	// Assignment events store names as "old -> new" text.
	if _, err = tx.Exec(ctx, `UPDATE ticket_events SET detail=
 (CASE WHEN split_part(detail,' -> ',1)=$1 THEN $2 ELSE split_part(detail,' -> ',1) END)||' -> '||
 (CASE WHEN split_part(detail,' -> ',2)=$1 THEN $2 ELSE split_part(detail,' -> ',2) END)
 WHERE kind='assign' AND (split_part(detail,' -> ',1)=$1 OR split_part(detail,' -> ',2)=$1)`, name, erasedName); err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET name=$2, subject=NULL, login_email=NULL, image=NULL, email_verified=false,
 role='student', admitted=false, cohort_member=false, login_enabled=false, category_ids='{}', email_reminders_enabled=false, erased_at=now()
 WHERE id=$1`, id, erasedName); err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) && strings.Contains(pe.Message, "last usable administrator") {
			return nil, nil, errors.New("erasure rejected; no changes committed (the last usable administrator cannot be erased)")
		}
		return nil, nil, err
	}
	// The revoke trigger quarantines the old address; an erased person's address must not stay behind.
	if _, err = tx.Exec(ctx, "DELETE FROM retired_login_emails WHERE user_id=$1", id); err != nil {
		return nil, nil, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO user_operator_audit(user_id,action) VALUES($1,'user.erased')", id); err != nil {
		return nil, nil, err
	}
	counts["files"] = len(keys)
	return counts, keys, nil
}

// lockBackup takes the backup script's flock. Without a status file or lock file no backup has run, so there is nothing to race.
func lockBackup(statusFile string) (func(), error) {
	if statusFile == "" {
		return func() {}, nil
	}
	f, err := os.Open(statusFile + ".lock")
	if errors.Is(err, os.ErrNotExist) {
		return func() {}, nil
	}
	if err != nil {
		return nil, errors.New("cannot open backup lock; no changes made")
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, errors.New("cannot take backup lock; no changes made")
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
