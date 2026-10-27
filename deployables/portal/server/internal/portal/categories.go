package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const categoryCols = "id::text,name,description,kind,repeatable,ongoing,closes_at,status,allow_self_vote,all_people,max_choices,version,created_at,opened_at"

func validKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo" || k == "person" || k == "proposal" || k == "words"
}
func contributionKind(k string) bool {
	return k == "idea" || k == "quote" || k == "memory" || k == "photo"
}

func ballotKind(k string) bool { return k == "person" || k == "proposal" || k == "words" }

func scanCategory(row pgx.Row) (Category, error) {
	c := Category{Options: []PollOption{}, MyWords: []string{}, MyOptionIDs: []string{}}
	e := row.Scan(&c.ID, &c.Name, &c.Description, &c.Kind, &c.Repeatable, &c.Ongoing, &c.ClosesAt, &c.Status, &c.AllowSelfVote, &c.AllPeople, &c.MaxChoices, &c.Version, &c.CreatedAt, &c.OpenedAt)
	if e == nil && c.Status == "open" && c.ClosesAt != nil && !c.ClosesAt.After(time.Now()) {
		c.Status = "closed"
	}
	return c, e
}

// fillBallots adds options, the viewer's own choice and (editors only) ballot counts and participation to the
// ballot categories of cs using one query each, however many categories there are.
func fillBallots(ctx context.Context, db DB, u User, cs []Category) error {
	idx := map[string]int{}
	ids := []string{}
	optionIDs := []string{}
	for i := range cs {
		if ballotKind(cs[i].Kind) {
			idx[cs[i].ID] = i
			ids = append(ids, cs[i].ID)
			if cs[i].Kind != "words" {
				optionIDs = append(optionIDs, cs[i].ID)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var rows pgx.Rows
	var e error
	if len(optionIDs) > 0 {
		rows, e = db.Query(ctx, "SELECT poll_id::text,id::text,label,user_id::text FROM poll_options WHERE poll_id=ANY($1::uuid[]) ORDER BY poll_id,position", optionIDs)
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
	}
	rows, e = db.Query(ctx, `WITH latest AS (
		SELECT poll_id,ballot_id FROM (
			SELECT poll_id,ballot_id,row_number() OVER (PARTITION BY poll_id ORDER BY max(created_at) DESC,ballot_id DESC) AS rank
			FROM ballots WHERE user_id=$1 AND poll_id=ANY($2::uuid[])
			GROUP BY poll_id,ballot_id
		) grouped WHERE rank=1
	)
	SELECT b.poll_id::text,b.option_id::text,o.label
	FROM ballots b JOIN latest l USING(poll_id,ballot_id)
	JOIN poll_options o ON o.poll_id=b.poll_id AND o.id=b.option_id
	WHERE b.user_id=$1
	ORDER BY b.poll_id,b.option_id`, u.ID, ids)
	if e != nil {
		return e
	}
	for rows.Next() {
		var pid, oid, label string
		if e = rows.Scan(&pid, &oid, &label); e != nil {
			rows.Close()
			return e
		}
		if cs[idx[pid]].MyOptionID == nil {
			cs[idx[pid]].MyOptionID = &oid
		}
		cs[idx[pid]].MyOptionIDs = append(cs[idx[pid]].MyOptionIDs, oid)
		if cs[idx[pid]].Kind == "words" {
			cs[idx[pid]].MyWords = append(cs[idx[pid]].MyWords, label)
		}
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

// checkContributionCategory validates the category and enforces its per-author cap.
// Callers serialize writes for authorID before taking category or submission row locks.
func checkContributionCategory(ctx context.Context, db DB, id, authorID, excludeID string, requireOpen bool) error {
	var kind string
	var repeatable bool
	var status string
	var closesAt *time.Time
	e := db.QueryRow(ctx, "SELECT kind,repeatable,status,closes_at FROM categories WHERE id=$1 FOR SHARE", id).Scan(&kind, &repeatable, &status, &closesAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return bad("Sammlung nicht gefunden.")
	}
	if e != nil {
		return e
	}
	if !contributionKind(kind) {
		return bad("In dieser Sammlung können keine Beiträge eingereicht werden.")
	}
	if requireOpen && (status != "open" || closesAt != nil && !closesAt.After(time.Now())) {
		return bad("In diese Sammlung können nur bei geöffnetem Status Beiträge eingereicht oder verschoben werden.")
	}
	if !repeatable {
		var exists bool
		if e = db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM submissions WHERE category_id=$1 AND author_id=$2 AND ($3='' OR id::text<>$3))", id, authorID, excludeID).Scan(&exists); e != nil {
			return e
		}
		if exists {
			return bad("Für diese Sammlung ist nur ein Beitrag pro Person möglich.")
		}
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
	Name          string     `json:"name"`
	Description   string     `json:"description"`
	Kind          string     `json:"kind"`
	Repeatable    *bool      `json:"repeatable"`
	Ongoing       *bool      `json:"ongoing"`
	ClosesAt      *time.Time `json:"closes_at"`
	AllowSelfVote bool       `json:"allow_self_vote"`
	AllPeople     *bool      `json:"all_people"`
	MaxChoices    *int       `json:"max_choices"`
	Options       []struct {
		Label  string  `json:"label"`
		UserID *string `json:"user_id,omitempty"`
	} `json:"options"`
	Version      int `json:"version"`
	deadlineOnly bool
	hasClosesAt  bool
}

func (in *categoryInput) UnmarshalJSON(data []byte) error {
	type input categoryInput
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if e := d.Decode((*input)(in)); e != nil {
		return e
	}
	var fields map[string]json.RawMessage
	if e := json.Unmarshal(data, &fields); e != nil {
		return e
	}
	in.deadlineOnly = len(fields) == 2 && fields["version"] != nil && fields["closes_at"] != nil
	in.hasClosesAt = fields["closes_at"] != nil
	return nil
}

func validateCategory(in categoryInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 300 || len(in.Description) > 10000 {
		return bad("Name erforderlich (max. 300 Zeichen); Beschreibung zu lang.")
	}
	if !validKind(in.Kind) {
		return bad("Ungültiger Sammlungstyp.")
	}
	if in.MaxChoices != nil && (*in.MaxChoices < 1 || *in.MaxChoices > 500 || contributionKind(in.Kind) && *in.MaxChoices != 1) {
		return bad("Maximale Auswahl muss 1 bis 500 betragen; Beitragssammlungen haben keine Mehrfachauswahl.")
	}
	if in.Kind != "person" && in.AllPeople != nil && *in.AllPeople {
		return bad("Alle Personen ist nur für Personenabstimmungen erlaubt.")
	}
	if contributionKind(in.Kind) {
		if len(in.Options) != 0 {
			return bad("Diese Sammlung hat keine Optionen.")
		}
		return nil
	}
	if in.Kind == "words" {
		if len(in.Options) != 0 {
			return bad("Diese Abstimmung erstellt Optionen aus den abgegebenen Wörtern.")
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
	var closesAt *time.Time
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
		if !canEdit(u, id) {
			return forbidden()
		}
		if in.deadlineOnly {
			if in.Version != old.Version {
				return conflict()
			}
			if !ballotKind(old.Kind) || old.Ongoing {
				return bad("Nur befristete Abstimmungen haben einen bearbeitbaren Endzeitpunkt.")
			}
			if in.ClosesAt == nil || !in.ClosesAt.After(time.Now()) {
				return bad("Ein zukünftiger Endzeitpunkt ist erforderlich.")
			}
			// Updating only the deadline preserves definitions, candidate snapshots,
			// ballots and stored status, including an automatically expired open poll.
			if _, e = tx.Exec(r.Context(), "UPDATE categories SET closes_at=$2,version=version+1 WHERE id=$1", id, in.ClosesAt); e != nil {
				return e
			}
			if e = audit(r.Context(), tx, u, "poll.saved", id); e != nil {
				return e
			}
			c, e := loadCategory(r.Context(), tx, id, u, false)
			if e != nil {
				return e
			}
			if e = tx.Commit(r.Context()); e != nil {
				return e
			}
			jsonOut(w, http.StatusOK, c)
			return nil
		}
		if in.AllPeople == nil {
			all := in.Kind == "person" && old.AllPeople
			in.AllPeople = &all
		}
		if in.Repeatable == nil {
			repeatable := old.Repeatable
			in.Repeatable = &repeatable
		}
		if in.Ongoing == nil {
			ongoing := old.Ongoing
			in.Ongoing = &ongoing
		}
		if in.MaxChoices == nil {
			max := 1
			if ballotKind(in.Kind) {
				max = old.MaxChoices
			}
			in.MaxChoices = &max
		}
		if e = validateCategory(in); e != nil {
			return e
		}
		if contributionKind(in.Kind) != contributionKind(old.Kind) {
			return bad("Der Typ darf nur innerhalb seiner Gruppe geändert werden.")
		}
		if in.Version != old.Version || ballotKind(old.Kind) && (old.Status != "draft" || old.OpenedAt != nil) {
			return conflict()
		}
		if in.Kind == "photo" && old.Kind != "photo" {
			var incompatible bool
			if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM submissions s WHERE category_id=$1 AND (body<>'' OR NOT EXISTS(SELECT 1 FROM attachments a WHERE a.submission_id=s.id AND NOT a.deleted)))", id).Scan(&incompatible); e != nil {
				return e
			}
			if incompatible {
				return bad("Eine Fotosammlung darf nur Beiträge mit Bild und ohne Beitragstext enthalten.")
			}
		}
		if old.Kind == "photo" && in.Kind != "photo" {
			var hasPhotos bool
			if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM submissions s JOIN attachments a ON a.submission_id=s.id WHERE s.category_id=$1 AND NOT a.deleted)", id).Scan(&hasPhotos); e != nil {
				return e
			}
			if hasPhotos {
				return bad("Eine Fotosammlung mit Bildern kann nicht in eine andere Sammlungsart geändert werden.")
			}
		}
		if *in.Repeatable != old.Repeatable {
			return bad("Die Häufigkeit der Beiträge kann nach dem Anlegen nicht geändert werden.")
		}
		if *in.Ongoing != old.Ongoing {
			return bad("Der Fortlaufend-Status kann nach dem Anlegen nicht geändert werden.")
		}
		if old.Ongoing {
			closesAt = nil
		} else {
			if old.ClosesAt == nil {
				return bad("Für eine nicht fortlaufende Sammlung ist ein Endzeitpunkt erforderlich.")
			}
			closesAt = old.ClosesAt
			if ballotKind(old.Kind) && in.hasClosesAt && (in.ClosesAt == nil || !in.ClosesAt.Equal(*old.ClosesAt) && !in.ClosesAt.After(time.Now())) {
				return bad("Ein zukünftiger Endzeitpunkt ist erforderlich.")
			}
			if in.ClosesAt != nil && !in.ClosesAt.Equal(*old.ClosesAt) {
				if !ballotKind(old.Kind) {
					return bad("Der Endzeitpunkt kann nach dem Anlegen nicht geändert werden.")
				}
				closesAt = in.ClosesAt
			}
		}
	} else {
		if in.Repeatable == nil {
			repeatable := contributionKind(in.Kind)
			in.Repeatable = &repeatable
		}
		if in.Ongoing == nil {
			ongoing := true
			in.Ongoing = &ongoing
		}
		if !*in.Ongoing {
			if in.ClosesAt == nil || !in.ClosesAt.After(time.Now()) {
				return bad("Für eine nicht fortlaufende Sammlung ist ein zukünftiger Endzeitpunkt erforderlich.")
			}
			closesAt = in.ClosesAt
		}
		if in.AllPeople == nil {
			all := in.Kind == "person"
			in.AllPeople = &all
		}
		if in.MaxChoices == nil && in.Kind == "words" {
			max := 3
			in.MaxChoices = &max
		}
		if e = validateCategory(in); e != nil {
			return e
		}
	}
	rep := *in.Repeatable
	ongoing := *in.Ongoing
	selfVote := in.AllowSelfVote && ballotKind(in.Kind)
	allPeople := in.Kind == "person" && in.AllPeople != nil && *in.AllPeople
	maxChoices := 1
	if in.MaxChoices != nil {
		maxChoices = *in.MaxChoices
	}
	name := strings.TrimSpace(in.Name)
	if create {
		id = ID()
		status := "draft"
		if contributionKind(in.Kind) && ongoing {
			status = "open"
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO categories(id,name,description,kind,repeatable,ongoing,closes_at,status,allow_self_vote,all_people,max_choices,opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $8='open' THEN now() END)", id, name, in.Description, in.Kind, rep, ongoing, closesAt, status, selfVote, allPeople, maxChoices)
		if e == nil && u.Role == "manager" {
			_, e = tx.Exec(r.Context(), "UPDATE users SET category_ids=array_append(category_ids,$2::uuid) WHERE id=$1", u.ID, id)
		}
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE categories SET name=$2,description=$3,kind=$4,repeatable=$5,ongoing=$6,closes_at=$7,allow_self_vote=$8,all_people=$9,max_choices=$10,version=version+1 WHERE id=$1", id, name, in.Description, in.Kind, rep, ongoing, closesAt, selfVote, allPeople, maxChoices)
		if e == nil && ballotKind(in.Kind) {
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
	if !ballotKind(in.Kind) {
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
	if in.Status != "draft" && in.Status != "open" && in.Status != "closed" {
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
	if in.Status == "open" && c.ClosesAt != nil && !c.ClosesAt.After(time.Now()) {
		return conflict()
	}
	validTransition := c.Status == "draft" && in.Status == "open" ||
		c.Status == "open" && (in.Status == "closed" || in.Status == "draft") ||
		c.Status == "closed" && in.Status == "draft"
	if in.Version != c.Version || !validTransition {
		return conflict()
	}
	if c.AllPeople && c.OpenedAt == nil && in.Status == "open" {
		if e = refreshPeopleOptions(r.Context(), tx, c.ID); e != nil {
			return e
		}
		c, e = loadCategory(r.Context(), tx, c.ID, u, false)
		if e != nil {
			return e
		}
	}
	if ballotKind(c.Kind) && c.Kind != "words" && len(c.Options) < 2 {
		return bad("Mindestens zwei Optionen erforderlich.")
	}
	if e = tx.QueryRow(r.Context(), "UPDATE categories SET status=$2,version=version+1,opened_at=CASE WHEN $2='open' AND opened_at IS NULL THEN now() ELSE opened_at END WHERE id=$1 RETURNING opened_at", c.ID, in.Status).Scan(&c.OpenedAt); e != nil {
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

func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) error {
	actor := current(r)
	if actor.Role != "admin" {
		return forbidden()
	}
	var in struct {
		Version int `json:"version"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(74120984)"); e != nil {
		return e
	}
	var kind string
	var version int
	e = tx.QueryRow(r.Context(), "SELECT kind,version FROM categories WHERE id=$1 FOR UPDATE", id).Scan(&kind, &version)
	if e != nil {
		return e
	}
	if version != in.Version {
		return conflict()
	}
	if !ballotKind(kind) {
		return bad("Beitragssammlungen können hier nicht gelöscht werden.")
	}
	for _, table := range []string{"ballots", "ballot_audit", "poll_options"} {
		if _, e = tx.Exec(r.Context(), "DELETE FROM "+table+" WHERE poll_id=$1", id); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE users SET category_ids=array_remove(category_ids,$1::uuid) WHERE $1::uuid=ANY(category_ids)", id); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM categories WHERE id=$1", id); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, actor, "poll.deleted", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	w.WriteHeader(http.StatusNoContent)
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
