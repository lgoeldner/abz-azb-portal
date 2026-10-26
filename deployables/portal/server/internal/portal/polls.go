package portal

import (
	"encoding/json"
	"net/http"
	"slices"
)

func (a *App) vote(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	var in struct {
		OptionID  json.RawMessage `json:"option_id"`
		OptionIDs json.RawMessage `json:"option_ids"`
		BallotID  string          `json:"ballot_id"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if len(in.OptionID) != 0 && len(in.OptionIDs) != 0 {
		return bad("Nur option_id oder option_ids angeben.")
	}
	ids := []string{}
	if len(in.OptionID) != 0 {
		var id string
		if json.Unmarshal(in.OptionID, &id) != nil {
			return bad("Ungültige Option.")
		}
		ids = append(ids, id)
	} else if len(in.OptionIDs) != 0 && json.Unmarshal(in.OptionIDs, &ids) != nil {
		return bad("Ungültige Optionen.")
	}
	if len(ids) == 0 {
		return bad("Mindestens eine Option erforderlich.")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !validID(id) || seen[id] {
			return bad("Ungültige oder doppelte Option.")
		}
		seen[id] = true
	}
	slices.Sort(ids)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	p, e := loadCategory(r.Context(), tx, r.PathValue("id"), u, true)
	if e != nil {
		return e
	}
	if !ballotKind(p.Kind) {
		return bad("Für diese Sammlung kann nicht abgestimmt werden.")
	}
	if p.Status == "draft" && !editor(u) {
		return missing()
	}
	var eligible bool
	if e = tx.QueryRow(r.Context(), "SELECT admitted AND cohort_member FROM users WHERE id=$1 FOR SHARE", u.ID).Scan(&eligible); e != nil {
		return e
	}
	if !eligible {
		return forbidden()
	}
	if len(ids) > p.MaxChoices {
		return bad("Zu viele Optionen ausgewählt.")
	}
	for _, id := range ids {
		found := false
		for _, o := range p.Options {
			if o.ID != id {
				continue
			}
			found = true
			if !p.AllowSelfVote && o.UserID != nil && *o.UserID == u.ID {
				return bad("Eine Stimme für dich selbst ist nicht erlaubt.")
			}
			break
		}
		if !found {
			return bad("Option gehört nicht zu dieser Umfrage.")
		}
	}
	ballotID := ID()
	if p.Repeatable {
		if !validID(in.BallotID) {
			return bad("Für wiederholbare Stimmabgaben ist eine ballot_id erforderlich.")
		}
		ballotID = in.BallotID
		rows, err := tx.Query(r.Context(), "SELECT option_id::text FROM ballots WHERE poll_id=$1 AND user_id=$2 AND ballot_id=$3 ORDER BY option_id", p.ID, u.ID, ballotID)
		if err != nil {
			return err
		}
		previous := []string{}
		for rows.Next() {
			var optionID string
			if err = rows.Scan(&optionID); err != nil {
				rows.Close()
				return err
			}
			previous = append(previous, optionID)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(previous) > 0 {
			if !slices.Equal(previous, ids) {
				return conflict()
			}
			if e = tx.Commit(r.Context()); e != nil {
				return e
			}
			jsonOut(w, 200, map[string]any{"option_id": ids[0], "option_ids": ids, "ballot_id": ballotID})
			return nil
		}
	}
	if p.Status != "open" {
		return conflict()
	}
	if !p.Repeatable && !slices.Equal(p.MyOptionIDs, ids) {
		if _, e = tx.Exec(r.Context(), "DELETE FROM ballots WHERE poll_id=$1 AND user_id=$2", p.ID, u.ID); e != nil {
			return e
		}
		for _, id := range ids {
			if _, e = tx.Exec(r.Context(), "INSERT INTO ballots(poll_id,user_id,ballot_id,option_id,created_at) VALUES($1,$2,$3,$4,clock_timestamp())", p.ID, u.ID, ballotID, id); e != nil {
				return e
			}
			if _, e = tx.Exec(r.Context(), "INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id) VALUES($1,$2,$3,$4,$5)", ID(), p.ID, u.ID, id, ballotID); e != nil {
				return e
			}
		}
	}
	if p.Repeatable {
		for _, id := range ids {
			if _, e = tx.Exec(r.Context(), "INSERT INTO ballots(poll_id,user_id,ballot_id,option_id,created_at) VALUES($1,$2,$3,$4,clock_timestamp())", p.ID, u.ID, ballotID, id); e != nil {
				return e
			}
			if _, e = tx.Exec(r.Context(), "INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id) VALUES($1,$2,$3,$4,$5)", ID(), p.ID, u.ID, id, ballotID); e != nil {
				return e
			}
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	response := map[string]any{"option_id": ids[0], "option_ids": ids}
	if p.Repeatable {
		response["ballot_id"] = ballotID
	}
	jsonOut(w, 200, response)
	return nil
}
func (a *App) results(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	id := r.PathValue("id")
	c, e := loadCategory(r.Context(), a.DB, id, u, false)
	if e != nil {
		return e
	}
	if !ballotKind(c.Kind) {
		return bad("Diese Sammlung hat keine Abstimmung.")
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
	c, e := loadCategory(r.Context(), a.DB, id, u, false)
	if e != nil {
		return e
	}
	if !ballotKind(c.Kind) {
		return bad("Diese Sammlung hat keine Abstimmung.")
	}
	rows, e := a.DB.Query(r.Context(), "SELECT b.user_id::text,u.name,b.option_id::text,o.label,b.created_at,b.ballot_id::text FROM ballot_audit b JOIN users u ON u.id=b.user_id JOIN poll_options o ON o.id=b.option_id WHERE b.poll_id=$1 ORDER BY b.created_at,b.ballot_id,b.option_id,b.id", id)
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []BallotAudit{}
	for rows.Next() {
		var x BallotAudit
		if e = rows.Scan(&x.UserID, &x.UserName, &x.OptionID, &x.OptionLabel, &x.CreatedAt, &x.BallotID); e != nil {
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
