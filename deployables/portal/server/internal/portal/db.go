package portal

import (
	"abizeitbetrug/server/migrations"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
)

type DB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func ID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120983)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); e != nil {
		return e
	}
	files, e := migrations.Files.ReadDir(".")
	if e != nil {
		return e
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		var exists bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", f.Name()).Scan(&exists); e != nil {
			return e
		}
		if exists {
			continue
		}
		sql, e := migrations.Files.ReadFile(f.Name())
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, string(sql)); e != nil {
			return fmt.Errorf("migration %s: %w", f.Name(), e)
		}
		if _, e = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", f.Name()); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func scanUser(row pgx.Row) (User, error) {
	u := User{}
	e := row.Scan(&u.ID, &u.Name, &u.Role, &u.Admitted, &u.CohortMember, &u.CategoryIDs, &u.CreatedAt)
	if u.CategoryIDs == nil {
		u.CategoryIDs = []string{}
	}
	return u, e
}

const userCols = "id::text,name,role,admitted,cohort_member,category_ids::text[],created_at"

func audit(ctx context.Context, db DB, u User, action, entity string) error {
	_, e := db.Exec(ctx, "INSERT INTO audit_events(id,actor_id,action,entity_id) VALUES($1,$2,$3,$4)", ID(), u.ID, action, entity)
	return e
}
func snapshot(ctx context.Context, db DB, u User, s Submission) error {
	attachments, e := json.Marshal(s.Attachments)
	if e != nil {
		return e
	}
	_, e = db.Exec(ctx, "INSERT INTO revisions(id,submission_id,version,actor_id,title,body,context,status,attachments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", ID(), s.ID, s.Version, u.ID, s.Title, s.Body, s.Context, s.Status, attachments)
	return e
}
