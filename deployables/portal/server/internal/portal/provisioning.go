package portal

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"net/mail"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type provisionRecord struct {
	ID, Email, Name                      string
	Role                                 *string
	Admitted, CohortMember, LoginEnabled *bool
}

func normalizedEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || parsed.Name != "" || len(value) > 254 || !strings.Contains(strings.SplitN(value, "@", 2)[1], ".") {
		return "", errors.New("invalid email address")
	}
	return value, nil
}
func parseRoster(reader io.Reader, allowElevated bool) ([]provisionRecord, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, (10<<20)+1))
	if err != nil || len(raw) > 10<<20 {
		return nil, errors.New("CSV exceeds 10 MiB or cannot be read")
	}
	r := csv.NewReader(bytes.NewReader(raw))
	r.TrimLeadingSpace = true
	header, err := r.Read()
	if err != nil {
		return nil, errors.New("CSV header required")
	}
	fields := map[string]int{}
	allowed := map[string]bool{"id": true, "email": true, "name": true, "role": true, "admitted": true, "cohort_member": true, "login_enabled": true}
	for i, key := range header {
		key = strings.TrimSpace(key)
		if !allowed[key] {
			return nil, errors.New("unknown CSV column")
		}
		if _, ok := fields[key]; ok {
			return nil, errors.New("duplicate CSV column")
		}
		fields[key] = i
	}
	if _, ok := fields["email"]; !ok {
		return nil, errors.New("email column required")
	}
	if _, ok := fields["name"]; !ok {
		return nil, errors.New("name column required")
	}
	rows := []provisionRecord{}
	seenEmail := map[string]bool{}
	seenID := map[string]bool{}
	for {
		cells, e := r.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, errors.New("invalid CSV row")
		}
		if len(rows) >= 10000 {
			return nil, errors.New("CSV has too many rows")
		}
		get := func(key string) string {
			if i, ok := fields[key]; ok {
				return strings.TrimSpace(cells[i])
			}
			return ""
		}
		row := provisionRecord{ID: get("id"), Name: get("name")}
		row.Email, e = normalizedEmail(get("email"))
		if e != nil || row.Name == "" || len(row.Name) > 200 || strings.ContainsAny(row.Name, "\x00\r\n") {
			return nil, errors.New("invalid name or email in CSV")
		}
		if row.ID != "" && !validID(row.ID) {
			return nil, errors.New("invalid user UUID in CSV")
		}
		if seenEmail[row.Email] || row.ID != "" && seenID[row.ID] {
			return nil, errors.New("duplicate identity in CSV")
		}
		seenEmail[row.Email] = true
		seenID[row.ID] = true
		if role := get("role"); role != "" {
			if role != "student" && role != "manager" && role != "admin" {
				return nil, errors.New("invalid role in CSV")
			}
			if role != "student" && !allowElevated {
				return nil, errors.New("elevated roles require --allow-elevated")
			}
			row.Role = &role
		}
		for key, dst := range map[string]**bool{"admitted": &row.Admitted, "cohort_member": &row.CohortMember, "login_enabled": &row.LoginEnabled} {
			if value := get(key); value != "" {
				if value != "true" && value != "false" {
					return nil, errors.New("CSV flags must be true or false")
				}
				b := value == "true"
				*dst = &b
			}
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil, errors.New("CSV has no users")
	}
	return rows, nil
}
func importRoster(ctx context.Context, tx pgx.Tx, rows []provisionRecord) ([]string, error) {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		var id any
		if row.ID != "" {
			id = row.ID
		}
		var uid string
		if err := tx.QueryRow(ctx, "SELECT portal_provision_user($1::uuid,$2,$3,$4,$5,$6,$7)::text", id, row.Email, row.Name, row.Role, row.Admitted, row.CohortMember, row.LoginEnabled).Scan(&uid); err != nil {
			return nil, errors.New("user import rejected; no changes committed (check identity conflicts and administrator safeguards)")
		}
		ids = append(ids, uid)
	}
	return ids, nil
}

// RunUserCommand deliberately defaults to rollback. It uses the same database
// functions available to a trusted operator through psql, with no provider calls.
func RunUserCommand(ctx context.Context, pool *pgxpool.Pool, args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: portal users import|set-email|disable|revoke-sessions")
	}
	fs := flag.NewFlagSet("users", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var path, id, email string
	var apply, dry, allowElevated bool
	fs.StringVar(&path, "file", "", "CSV file")
	fs.StringVar(&id, "id", "", "user UUID")
	fs.StringVar(&email, "email", "", "new email")
	fs.BoolVar(&apply, "apply", false, "commit changes")
	fs.BoolVar(&dry, "dry-run", false, "roll back changes")
	fs.BoolVar(&allowElevated, "allow-elevated", false, "allow explicit elevated roles")
	if err := fs.Parse(args[1:]); err != nil || fs.NArg() != 0 || apply && dry {
		return errors.New("invalid users command options")
	}
	var rows []provisionRecord
	if args[0] == "import" {
		if path == "" {
			return errors.New("--file required")
		}
		f, err := os.Open(path)
		if err != nil {
			return errors.New("cannot open roster file")
		}
		defer f.Close()
		rows, err = parseRoster(f, allowElevated)
		if err != nil {
			return err
		}
	} else if !validID(id) {
		return errors.New("--id requires a user UUID")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return errors.New("cannot start user transaction")
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120984)"); err != nil {
		return errors.New("cannot lock user transaction")
	}
	ids := []string{id}
	switch args[0] {
	case "import":
		ids, err = importRoster(ctx, tx, rows)
	case "set-email":
		var normalized string
		normalized, err = normalizedEmail(email)
		if err == nil {
			_, err = tx.Exec(ctx, "SELECT portal_set_user_email($1::uuid,$2)", id, normalized)
		}
	case "disable":
		_, err = tx.Exec(ctx, "SELECT portal_disable_user($1::uuid)", id)
	case "revoke-sessions":
		var exists bool
		err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)", id).Scan(&exists)
		if err == nil && !exists {
			err = errors.New("unknown user")
		}
		if err == nil {
			_, err = tx.Exec(ctx, "DELETE FROM auth_sessions WHERE user_id=$1", id)
		}
		if err == nil {
			_, err = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", id)
		}
		if err == nil {
			_, err = tx.Exec(ctx, "DELETE FROM auth_verifications WHERE CASE WHEN value IS JSON OBJECT THEN lower(value::jsonb->>'email')=(SELECT login_email FROM users WHERE id=$1) ELSE false END", id)
		}
		if err == nil {
			_, err = tx.Exec(ctx, "INSERT INTO user_operator_audit(user_id,action) VALUES($1,'user.sessions_revoked')", id)
		}
	default:
		return errors.New("unknown users command")
	}
	if err != nil {
		return errors.New("user operation rejected; no changes committed (check identity conflicts and administrator safeguards)")
	}
	if apply {
		if err = tx.Commit(ctx); err != nil {
			return errors.New("user changes could not be committed")
		}
	}
	return json.NewEncoder(out).Encode(struct {
		Applied bool     `json:"applied"`
		Count   int      `json:"count"`
		IDs     []string `json:"user_ids"`
	}{apply, len(ids), ids})
}
