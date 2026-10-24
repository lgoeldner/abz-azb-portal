package portal

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const categoryCols = "id::text,name,description,kind,status,allow_self_vote,version,created_at,opened_at"

func validKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo" || k == "person" || k == "proposal"
}
func repeatableKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo"
}

func scanCategory(row pgx.Row) (Category, error) {
	c := Category{Options: []PollOption{}}
	e := row.Scan(&c.ID, &c.Name, &c.Description, &c.Kind, &c.Status, &c.AllowSelfVote, &c.Version, &c.CreatedAt, &c.OpenedAt)
	c.Repeatable = repeatableKind(c.Kind)
	return c, e
}

// fillBallots adds options, the viewer's own choice and (editors only) the ballot count to the
// single-answer categories of cs using one query each, however many categories there are.
func fillBallots(ctx context.Context, db DB, u User, cs []Category) error {
	idx := map[string]int{}
	ids := []string{}
	for i := range cs {
		if !cs[i].Repeatable {
			idx[cs[i].ID] = i
			ids = append(ids, cs[i].ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, e := db.Query(ctx, "SELECT poll_id::text,id::text,label,user_id::text FROM poll_options WHERE poll_id=ANY($1::uuid[]) ORDER BY poll_id,position", ids)
	if e != nil {
		return e
	}
	for rows.Next() {
		var pid string
		var o PollOption
		if e = rows.Scan(&pid, &o.ID, &o.Label, &o.UserID); e != nil {
			rows.Close()
			return e
		}
		cs[idx[pid]].Options = append(cs[idx[pid]].Options, o)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	rows, e = db.Query(ctx, "SELECT poll_id::text,option_id::text FROM ballots WHERE user_id=$1 AND poll_id=ANY($2::uuid[])", u.ID, ids)
	if e != nil {
		return e
	}
	for rows.Next() {
		var pid, oid string
		if e = rows.Scan(&pid, &oid); e != nil {
			rows.Close()
			return e
		}
		cs[idx[pid]].MyOptionID = &oid
	}
	e = rows.Err()
	rows.Close()
	if e != nil || !editor(u) {
		return e
	}
	for _, i := range idx {
		n := 0
		cs[i].BallotCount = &n
	}
	rows, e = db.Query(ctx, "SELECT poll_id::text,count(*)::int FROM ballots WHERE poll_id=ANY($1::uuid[]) GROUP BY poll_id", ids)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var pid string
		var n int
		if e = rows.Scan(&pid, &n); e != nil {
			return e
		}
		cs[idx[pid]].BallotCount = &n
	}
	return rows.Err()
}

// loadCategory returns the category as seen by u. It does not hide drafts; callers decide.
func loadCategory(ctx context.Context, db DB, id string, u User, lock bool) (Category, error) {
	if !validID(id) {
		return Category{}, missing()
	}
	q := "SELECT " + categoryCols + " FROM categories WHERE id=$1"
	if lock {
		q += " FOR UPDATE"
	}
	c, e := scanCategory(db.QueryRow(ctx, q, id))
	if e != nil {
		return c, e
	}
	cs := []Category{c}
	if e = fillBallots(ctx, db, u, cs); e != nil {
		return c, e
	}
	return cs[0], nil
}

// requireRepeatable rejects unknown categories and single-answer ones for submissions.
func requireRepeatable(ctx context.Context, db DB, id string) error {
	var kind string
	e := db.QueryRow(ctx, "SELECT kind FROM categories WHERE id=$1", id).Scan(&kind)
	if errors.Is(e, pgx.ErrNoRows) {
		return bad("Sammlung nicht gefunden.")
	}
	if e != nil {
		return e
	}
	if !repeatableKind(kind) {
		return bad("Beiträge sind nur in Sammlungen mit beliebig vielen Einträgen möglich.")
	}
	return nil
}

func (a *App) listCategories(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	rows, e := a.DB.Query(r.Context(), "SELECT "+categoryCols+" FROM categories WHERE $1 OR status<>'draft' ORDER BY name,id", editor(u))
	if e != nil {
		return e
	}
	out := []Category{}
	for rows.Next() {
		c, e := scanCategory(rows)
		if e != nil {
			rows.Close()
			return e
		}
		out = append(out, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if e = fillBallots(r.Context(), a.DB, u, out); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}

type categoryInput struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	Kind          string `json:"kind"`
	AllowSelfVote bool   `json:"allow_self_vote"`
	Options       []struct {
		Label  string  `json:"label"`
		UserID *string `json:"user_id,omitempty"`
	} `json:"options"`
	Version int `json:"version"`
}

func validateCategory(in categoryInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 300 || len(in.Description) > 10000 {
		return bad("Name erforderlich (max. 300 Zeichen); Beschreibung zu lang.")
	}
	if !validKind(in.Kind) {
		return bad("Ungültiger Sammlungstyp.")
	}
	if repeatableKind(in.Kind) {
		if len(in.Options) != 0 {
			return bad("Diese Sammlung hat keine Optionen.")
		}
		return nil
	}
	if len(in.Options) < 2 || len(in.Options) > 500 {
		return bad("Eine Abstimmung benötigt 2 bis 500 Optionen.")
	}
	seen := map[string]bool{}
	for _, o := range in.Options {
		label := strings.TrimSpace(o.Label)
		if label == "" || len(label) > 300 {
			return bad("Optionsname erforderlich (max. 300 Zeichen).")
		}
		key := strings.ToLower(label)
		if in.Kind == "person" {
			if o.UserID == nil || !validID(*o.UserID) {
				return bad("Personenoption benötigt ein Mitglied.")
			}
			key = *o.UserID
		} else if o.UserID != nil {
			return bad("Vorschlagsoptionen dürfen keine Person zuordnen.")
		}
		if seen[key] {
			return bad("Optionen dürfen nicht doppelt vorkommen.")
		}
		seen[key] = true
	}
	return nil
}

func (a *App) writeCategory(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	var in categoryInput
	if e := decode(w, r, &in); e != nil {
		return e
	}
	id := r.PathValue("id")
	create := id == ""
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if !create {
		// Authorization on the stored record precedes input validation.
		old, e := loadCategory(r.Context(), tx, id, u, true)
		if e != nil {
			return e
		}
		if old.Repeatable && u.Role != "admin" || !canEdit(u, id) {
			return forbidden()
		}
		if e = validateCategory(in); e != nil {
			return e
		}
		if repeatableKind(in.Kind) != old.Repeatable {
			return bad("Der Typ darf nur innerhalb seiner Gruppe geändert werden.")
		}
		if in.Version != old.Version || old.Status != "draft" && !old.Repeatable {
			return conflict()
		}
	} else {
		if e = validateCategory(in); e != nil {
			return e
		}
		if repeatableKind(in.Kind) && u.Role != "admin" {
			return forbidden()
		}
	}
	rep := repeatableKind(in.Kind)
	selfVote := in.AllowSelfVote && !rep
	name := strings.TrimSpace(in.Name)
	if create {
		id = ID()
		status := "draft"
		if rep {
			status = "open"
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO categories(id,name,description,kind,status,allow_self_vote,opened_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $5='open' THEN now() END)", id, name, in.Description, in.Kind, status, selfVote)
		if e == nil && !rep && u.Role == "manager" {
			_, e = tx.Exec(r.Context(), "UPDATE users SET category_ids=array_append(category_ids,$2::uuid) WHERE id=$1", u.ID, id)
		}
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE categories SET name=$2,description=$3,kind=$4,allow_self_vote=$5,version=version+1 WHERE id=$1", id, name, in.Description, in.Kind, selfVote)
		if e == nil && !rep {
			_, e = tx.Exec(r.Context(), "DELETE FROM poll_options WHERE poll_id=$1", id)
		}
	}
	if e != nil {
		return e
	}
	for i, o := range in.Options {
		label := strings.TrimSpace(o.Label)
		if o.UserID != nil {
			e = tx.QueryRow(r.Context(), "SELECT name FROM users WHERE id=$1 AND admitted AND cohort_member", *o.UserID).Scan(&label)
			if errors.Is(e, pgx.ErrNoRows) {
				return bad("Person ist kein zugelassenes Jahrgangsmitglied.")
			}
			if e != nil {
				return e
			}
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO poll_options(id,poll_id,label,user_id,position) VALUES($1,$2,$3,$4,$5)", ID(), id, label, o.UserID, i); e != nil {
			return e
		}
	}
	action := "poll.saved"
	if rep {
		action = "category.saved"
	}
	if e = audit(r.Context(), tx, u, action, id); e != nil {
		return e
	}
	c, e := loadCategory(r.Context(), tx, id, u, false)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	code := 200
	if create {
		code = 201
	}
	jsonOut(w, code, c)
	return nil
}

func (a *App) statusCategory(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	var in struct {
		Version int    `json:"version"`
		Status  string `json:"status"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if in.Status != "open" && in.Status != "closed" {
		return bad("Ungültiger Status.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	c, e := loadCategory(r.Context(), tx, r.PathValue("id"), u, true)
	if e != nil {
		return e
	}
	if !canEdit(u, c.ID) {
		return forbidden()
	}
	if c.Repeatable {
		return bad("Diese Sammlung hat keinen Abstimmungsstatus.")
	}
	if in.Version != c.Version || !(c.Status == "draft" && in.Status == "open" || c.Status == "open" && in.Status == "closed") {
		return conflict()
	}
	if len(c.Options) < 2 {
		return bad("Mindestens zwei Optionen erforderlich.")
	}
	if e = tx.QueryRow(r.Context(), "UPDATE categories SET status=$2,version=version+1,opened_at=CASE WHEN $2='open' THEN now() ELSE opened_at END WHERE id=$1 RETURNING opened_at", c.ID, in.Status).Scan(&c.OpenedAt); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "poll.status."+in.Status, c.ID); e != nil {
		return e
	}
	c.Status = in.Status
	c.Version++
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, c)
	return nil
}
