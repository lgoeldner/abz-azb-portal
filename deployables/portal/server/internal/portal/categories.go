package portal

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const categoryCols = "id::text,name,description,kind,status,allow_self_vote,all_people,max_choices,version,created_at,opened_at"

func validKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo" || k == "person" || k == "proposal"
}
func repeatableKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo"
}

func scanCategory(row pgx.Row) (Category, error) {
	c := Category{Options: []PollOption{}, MyOptionIDs: []string{}}
	e := row.Scan(&c.ID, &c.Name, &c.Description, &c.Kind, &c.Status, &c.AllowSelfVote, &c.AllPeople, &c.MaxChoices, &c.Version, &c.CreatedAt, &c.OpenedAt)
	c.Repeatable = repeatableKind(c.Kind)
	return c, e
}

// fillBallots adds options, the viewer's own choice and (editors only) ballot counts and participation to the
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
	rows, e = db.Query(ctx, "SELECT poll_id::text,option_id::text FROM ballots WHERE user_id=$1 AND poll_id=ANY($2::uuid[]) ORDER BY option_id", u.ID, ids)
	if e != nil {
		return e
	}
	for rows.Next() {
		var pid, oid string
		if e = rows.Scan(&pid, &oid); e != nil {
			rows.Close()
			return e
		}
		if cs[idx[pid]].MyOptionID == nil {
			cs[idx[pid]].MyOptionID = &oid
		}
		cs[idx[pid]].MyOptionIDs = append(cs[idx[pid]].MyOptionIDs, oid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil || !editor(u) {
		return e
	}
	// Count current eligibility and ballots in the same statement snapshot. Stored
	// ballots remain in ballot_count, while participation only counts eligible voters.
	rows, e = db.Query(ctx, `SELECT p.id::text,count(DISTINCT b.user_id)::int,
		count(DISTINCT b.user_id) FILTER (WHERE u.admitted AND u.cohort_member)::int,
		(SELECT count(*)::int FROM users WHERE admitted AND cohort_member)
		FROM unnest($1::uuid[]) AS p(id)
		LEFT JOIN ballots b ON b.poll_id=p.id
		LEFT JOIN users u ON u.id=b.user_id
		GROUP BY p.id`, ids)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var pid string
		var n int
		var participation VotingParticipation
		if e = rows.Scan(&pid, &n, &participation.Voted, &participation.Eligible); e != nil {
			return e
		}
		cs[idx[pid]].BallotCount = &n
		cs[idx[pid]].Participation = &participation
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
	AllPeople     *bool  `json:"all_people"`
	MaxChoices    *int   `json:"max_choices"`
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
	if in.MaxChoices != nil && (*in.MaxChoices < 1 || *in.MaxChoices > 500 || in.Kind != "person" && *in.MaxChoices != 1) {
		return bad("Maximale Auswahl muss 1 bis 500 betragen; mehrere Stimmen sind nur für Personen erlaubt.")
	}
	if in.Kind != "person" && in.AllPeople != nil && *in.AllPeople {
		return bad("Alle Personen ist nur für Personenabstimmungen erlaubt.")
	}
	if repeatableKind(in.Kind) {
		if len(in.Options) != 0 {
			return bad("Diese Sammlung hat keine Optionen.")
		}
		return nil
	}
	if in.Kind == "person" && in.AllPeople != nil && *in.AllPeople {
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
		if in.AllPeople == nil {
			all := in.Kind == "person" && old.AllPeople
			in.AllPeople = &all
		}
		if in.MaxChoices == nil {
			max := 1
			if in.Kind == "person" {
				max = old.MaxChoices
			}
			in.MaxChoices = &max
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
		if in.AllPeople == nil {
			all := in.Kind == "person"
			in.AllPeople = &all
		}
		if e = validateCategory(in); e != nil {
			return e
		}
		if repeatableKind(in.Kind) && u.Role != "admin" {
			return forbidden()
		}
	}
	rep := repeatableKind(in.Kind)
	selfVote := in.AllowSelfVote && !rep
	allPeople := in.Kind == "person" && in.AllPeople != nil && *in.AllPeople
	maxChoices := 1
	if in.MaxChoices != nil {
		maxChoices = *in.MaxChoices
	}
	name := strings.TrimSpace(in.Name)
	if create {
		id = ID()
		status := "draft"
		if rep {
			status = "open"
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO categories(id,name,description,kind,status,allow_self_vote,all_people,max_choices,opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $5='open' THEN now() END)", id, name, in.Description, in.Kind, status, selfVote, allPeople, maxChoices)
		if e == nil && !rep && u.Role == "manager" {
			_, e = tx.Exec(r.Context(), "UPDATE users SET category_ids=array_append(category_ids,$2::uuid) WHERE id=$1", u.ID, id)
		}
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE categories SET name=$2,description=$3,kind=$4,allow_self_vote=$5,all_people=$6,max_choices=$7,version=version+1 WHERE id=$1", id, name, in.Description, in.Kind, selfVote, allPeople, maxChoices)
		if e == nil && !rep {
			_, e = tx.Exec(r.Context(), "DELETE FROM poll_options WHERE poll_id=$1", id)
		}
	}
	if e != nil {
		return e
	}
	if allPeople {
		if e = refreshPeopleOptions(r.Context(), tx, id); e != nil {
			return e
		}
		in.Options = nil
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
	if c.AllPeople && c.Status == "draft" && in.Status == "open" {
		if e = refreshPeopleOptions(r.Context(), tx, c.ID); e != nil {
			return e
		}
		c, e = loadCategory(r.Context(), tx, c.ID, u, false)
		if e != nil {
			return e
		}
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

// All-person polls snapshot the admitted roster when saved and once more when opened.
// Open polls keep their option IDs and labels even if cohort membership later changes.
func refreshPeopleOptions(ctx context.Context, tx pgx.Tx, id string) error {
	if _, err := tx.Exec(ctx, "DELETE FROM poll_options WHERE poll_id=$1", id); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, "SELECT id::text,name FROM users WHERE admitted AND cohort_member ORDER BY name,id")
	if err != nil {
		return err
	}
	options := []PollOption{}
	for rows.Next() {
		var o PollOption
		if err = rows.Scan(&o.UserID, &o.Label); err != nil {
			rows.Close()
			return err
		}
		options = append(options, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for i, o := range options {
		if _, err = tx.Exec(ctx, "INSERT INTO poll_options(id,poll_id,label,user_id,position) VALUES($1,$2,$3,$4,$5)", ID(), id, o.Label, o.UserID, i); err != nil {
			return err
		}
	}
	return nil
}
