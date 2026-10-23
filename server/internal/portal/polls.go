package portal

import (
	"context"
	"net/http"
	"strings"
)

func loadPoll(ctx context.Context, db DB, id, userID string, lock bool) (Poll, error) {
	p := Poll{Format: "single_choice", Options: []PollOption{}}
	if !validID(id) {
		return p, missing()
	}
	q := "SELECT id::text,category_id::text,title,description,kind,status,allow_self_vote,version FROM polls WHERE id=$1"
	if lock {
		q += " FOR UPDATE"
	}
	e := db.QueryRow(ctx, q, id).Scan(&p.ID, &p.CategoryID, &p.Title, &p.Description, &p.Kind, &p.Status, &p.AllowSelfVote, &p.Version)
	if e != nil {
		return p, e
	}
	rows, e := db.Query(ctx, "SELECT id::text,label,user_id::text FROM poll_options WHERE poll_id=$1 ORDER BY position", id)
	if e != nil {
		return p, e
	}
	for rows.Next() {
		var o PollOption
		if e = rows.Scan(&o.ID, &o.Label, &o.UserID); e != nil {
			rows.Close()
			return p, e
		}
		p.Options = append(p.Options, o)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return p, e
	}
	e = db.QueryRow(ctx, "SELECT (SELECT option_id::text FROM ballots WHERE poll_id=$1 AND user_id=$2)", id, userID).Scan(&p.MyOptionID)
	return p, e
}
func (a *App) listPolls(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	rows, e := a.DB.Query(r.Context(), "SELECT id::text FROM polls WHERE $1 OR status<>'draft' ORDER BY title,id", editor(u))
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	out := []Poll{}
	for _, id := range ids {
		p, e := loadPoll(r.Context(), a.DB, id, u.ID, false)
		if e != nil {
			return e
		}
		out = append(out, p)
	}
	jsonOut(w, 200, out)
	return nil
}

type pollInput struct {
	CategoryID    string `json:"category_id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	Kind          string `json:"kind"`
	AllowSelfVote bool   `json:"allow_self_vote"`
	Options       []struct {
		Label  string  `json:"label"`
		UserID *string `json:"user_id,omitempty"`
	} `json:"options"`
	Version int `json:"version"`
}

func validatePoll(in pollInput) error {
	if !validID(in.CategoryID) || strings.TrimSpace(in.Title) == "" || len(in.Title) > 300 || len(in.Description) > 10000 {
		return bad("Kategorie und Titel erforderlich; Text zu lang.")
	}
	if in.Kind != "person" && in.Kind != "proposal" {
		return bad("Ungültiger Umfragetyp.")
	}
	if len(in.Options) < 2 || len(in.Options) > 500 {
		return bad("Eine Umfrage benötigt 2 bis 500 Optionen.")
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
func (a *App) writePoll(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	var in pollInput
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if e := validatePoll(in); e != nil {
		return e
	}
	if !canEdit(u, in.CategoryID) {
		return forbidden()
	}
	id := r.PathValue("id")
	create := id == ""
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if create {
		id = ID()
		_, e = tx.Exec(r.Context(), "INSERT INTO polls(id,category_id,title,description,kind,allow_self_vote) VALUES($1,$2,$3,$4,$5,$6)", id, in.CategoryID, strings.TrimSpace(in.Title), in.Description, in.Kind, in.AllowSelfVote)
		if e != nil {
			return e
		}
	} else {
		p, e := loadPoll(r.Context(), tx, id, u.ID, true)
		if e != nil {
			return e
		}
		if !canEdit(u, p.CategoryID) {
			return forbidden()
		}
		if p.Status != "draft" || p.Version != in.Version {
			return conflict()
		}
		_, e = tx.Exec(r.Context(), "UPDATE polls SET category_id=$2,title=$3,description=$4,kind=$5,allow_self_vote=$6,version=version+1 WHERE id=$1", id, in.CategoryID, strings.TrimSpace(in.Title), in.Description, in.Kind, in.AllowSelfVote)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(r.Context(), "DELETE FROM poll_options WHERE poll_id=$1", id); e != nil {
			return e
		}
	}
	for i, o := range in.Options {
		label := strings.TrimSpace(o.Label)
		if o.UserID != nil {
			var eligible bool
			if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND admitted AND cohort_member)", *o.UserID).Scan(&eligible); e != nil {
				return e
			}
			if !eligible {
				return bad("Person ist kein zugelassenes Jahrgangsmitglied.")
			}
			if e = tx.QueryRow(r.Context(), "SELECT name FROM users WHERE id=$1", *o.UserID).Scan(&label); e != nil {
				return e
			}
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO poll_options(id,poll_id,label,user_id,position) VALUES($1,$2,$3,$4,$5)", ID(), id, label, o.UserID, i); e != nil {
			return e
		}
	}
	if e = audit(r.Context(), tx, u, "poll.saved", id); e != nil {
		return e
	}
	p, e := loadPoll(r.Context(), tx, id, u.ID, false)
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
	jsonOut(w, code, p)
	return nil
}
func (a *App) statusPoll(w http.ResponseWriter, r *http.Request) error {
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
		return bad("Ungültiger Umfragestatus.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	p, e := loadPoll(r.Context(), tx, r.PathValue("id"), u.ID, true)
	if e != nil {
		return e
	}
	if !canEdit(u, p.CategoryID) {
		return forbidden()
	}
	if in.Version != p.Version || !(p.Status == "draft" && in.Status == "open" || p.Status == "open" && in.Status == "closed") {
		return conflict()
	}
	if len(p.Options) < 2 {
		return bad("Mindestens zwei Optionen erforderlich.")
	}
	if _, e = tx.Exec(r.Context(), "UPDATE polls SET status=$2,version=version+1 WHERE id=$1", p.ID, in.Status); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "poll.status."+in.Status, p.ID); e != nil {
		return e
	}
	p.Status = in.Status
	p.Version++
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, p)
	return nil
}
func (a *App) vote(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	var in struct {
		OptionID string `json:"option_id"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if !validID(in.OptionID) {
		return bad("Ungültige Option.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	p, e := loadPoll(r.Context(), tx, r.PathValue("id"), u.ID, true)
	if e != nil {
		return e
	}
	if p.Status == "draft" && !editor(u) {
		return missing()
	}
	if p.Status != "open" {
		return conflict()
	}
	var eligible bool
	if e = tx.QueryRow(r.Context(), "SELECT admitted AND cohort_member FROM users WHERE id=$1 FOR SHARE", u.ID).Scan(&eligible); e != nil {
		return e
	}
	if !eligible {
		return forbidden()
	}
	found := false
	for _, o := range p.Options {
		if o.ID == in.OptionID {
			found = true
			if !p.AllowSelfVote && o.UserID != nil && *o.UserID == u.ID {
				return bad("Eine Stimme für dich selbst ist nicht erlaubt.")
			}
		}
	}
	if !found {
		return bad("Option gehört nicht zu dieser Umfrage.")
	}
	if p.MyOptionID == nil || *p.MyOptionID != in.OptionID {
		if _, e = tx.Exec(r.Context(), "INSERT INTO ballots(poll_id,user_id,option_id) VALUES($1,$2,$3) ON CONFLICT(poll_id,user_id) DO UPDATE SET option_id=excluded.option_id,created_at=now()", p.ID, u.ID, in.OptionID); e != nil {
			return e
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO ballot_audit(id,poll_id,user_id,option_id) VALUES($1,$2,$3,$4)", ID(), p.ID, u.ID, in.OptionID); e != nil {
			return e
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, map[string]string{"option_id": in.OptionID})
	return nil
}
func (a *App) results(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	id := r.PathValue("id")
	if _, e := loadPoll(r.Context(), a.DB, id, u.ID, false); e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT o.id::text,o.label,count(b.user_id)::int FROM poll_options o LEFT JOIN ballots b ON b.option_id=o.id AND b.poll_id=o.poll_id WHERE o.poll_id=$1 GROUP BY o.id ORDER BY o.position", id)
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []PollResult{}
	for rows.Next() {
		var x PollResult
		if e = rows.Scan(&x.OptionID, &x.Label, &x.Count); e != nil {
			return e
		}
		out = append(out, x)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
func (a *App) ballotAudit(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if u.Role != "admin" {
		return forbidden()
	}
	id := r.PathValue("id")
	if _, e := loadPoll(r.Context(), a.DB, id, u.ID, false); e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT b.user_id::text,u.name,b.option_id::text,o.label,b.created_at FROM ballot_audit b JOIN users u ON u.id=b.user_id JOIN poll_options o ON o.id=b.option_id WHERE b.poll_id=$1 ORDER BY b.created_at,b.id", id)
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []BallotAudit{}
	for rows.Next() {
		var x BallotAudit
		if e = rows.Scan(&x.UserID, &x.UserName, &x.OptionID, &x.OptionLabel, &x.CreatedAt); e != nil {
			return e
		}
		out = append(out, x)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
func (a *App) roster(w http.ResponseWriter, r *http.Request) error {
	rows, e := a.DB.Query(r.Context(), "SELECT id::text,name FROM users WHERE admitted AND cohort_member ORDER BY name,id")
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, name string
		if e = rows.Scan(&id, &name); e != nil {
			return e
		}
		out = append(out, map[string]string{"id": id, "name": name})
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
