package portal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Tickets (Kanban board). Managers and admins only; the contract lives in
// docs/implementation-contract.md ("Tickets (Kanban board)").

type UserRef struct {
	ID   string `json:"id" format:"uuid"`
	Name string `json:"name"`
}
type Area struct {
	ID        string    `json:"id" format:"uuid"`
	Name      string    `json:"name"`
	Position  int       `json:"position"`
	Version   int       `json:"version"`
	Reviewers []UserRef `json:"reviewers"`
}
type TicketReview struct {
	User          UserRef   `json:"user"`
	Verdict       string    `json:"verdict" enum:"approve,changes"`
	Binding       bool      `json:"binding"`
	SelfConfirmed bool      `json:"self_confirmed"`
	UpdatedAt     time.Time `json:"updated_at"`
}
type Ticket struct {
	ID              string         `json:"id" format:"uuid"`
	Number          int64          `json:"number"`
	Type            string         `json:"type" enum:"aufgabe,artikel"`
	Title           string         `json:"title"`
	Body            string         `json:"body"`
	AreaID          string         `json:"area_id" format:"uuid"`
	AreaName        string         `json:"area_name"`
	Assignees       []UserRef      `json:"assignees" description:"Everyone working on the ticket, sorted by name; empty when nobody is."`
	CreatedBy       UserRef        `json:"created_by"`
	Size            string         `json:"size" enum:"XS,S,M,L,XL"`
	Goal            string         `json:"goal"`
	EstPages        *int           `json:"est_pages"`
	Status          string         `json:"status" enum:"todo,in_progress,review,done"`
	Round           int            `json:"round"`
	Version         int            `json:"version"`
	Approved        bool           `json:"approved" description:"True when the current round has a binding approval by a still admitted editor. Derived, never client-written."`
	Reviews         []TicketReview `json:"reviews" description:"Votes of the current round."`
	CommentCount    int            `json:"comment_count"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	StatusChangedAt time.Time      `json:"status_changed_at"`
}
type TicketEvent struct {
	ID        string    `json:"id" format:"uuid"`
	Kind      string    `json:"kind" enum:"comment,status,assign,review,edit"`
	Actor     UserRef   `json:"actor"`
	Body      string    `json:"body"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}
type TicketDetail struct {
	Ticket Ticket        `json:"ticket"`
	Events []TicketEvent `json:"events"`
}

var ticketSizes = map[string]bool{"XS": true, "S": true, "M": true, "L": true, "XL": true}
var ticketStatuses = map[string]bool{"todo": true, "in_progress": true, "review": true, "done": true}

const maxTicketPages = 1000

// ticketInner exposes one row per ticket with the derived "approved" flag: the current round has a
// binding approval by a voter who is still an admitted manager or admin.
const ticketInner = `SELECT t.id,t.number,t.type,t.title,t.body,t.area_id,a.name AS area_name,
 COALESCE((SELECT json_agg(json_build_object('id',ta.user_id::text,'name',au.name) ORDER BY au.name,ta.user_id)
  FROM ticket_assignees ta JOIN users au ON au.id=ta.user_id WHERE ta.ticket_id=t.id),'[]') AS assignees,
 t.created_by,cb.name AS creator_name,t.size,t.goal,t.est_pages,t.status,t.round,t.version,
 EXISTS(SELECT 1 FROM ticket_reviews r JOIN users v ON v.id=r.user_id
  WHERE r.ticket_id=t.id AND r.round=t.round AND r.verdict='approve' AND r.binding AND v.admitted AND v.role IN ('manager','admin')) AS approved,
 t.created_at,t.updated_at,t.status_changed_at,
 (SELECT count(*) FROM ticket_events ev WHERE ev.ticket_id=t.id AND ev.kind='comment') AS comment_count
 FROM tickets t JOIN areas a ON a.id=t.area_id JOIN users cb ON cb.id=t.created_by`
const ticketCols = "id::text,number,type,title,body,area_id::text,area_name,assignees,created_by::text,creator_name,size,goal,est_pages,status,round,version,approved,created_at,updated_at,status_changed_at,comment_count"

// reviewerPredicate: the user holds a default-reviewer grant for the area and is currently an admitted manager/admin.
const reviewerPredicate = "EXISTS(SELECT 1 FROM area_reviewers ar JOIN users u ON u.id=ar.user_id WHERE ar.area_id=$1 AND ar.user_id=$2 AND u.admitted AND u.role IN ('manager','admin'))"

type scanner interface{ Scan(dest ...any) error }

func scanTicket(row scanner) (Ticket, error) {
	var t Ticket
	var assignees []byte
	var creatorID, creatorName string
	if e := row.Scan(&t.ID, &t.Number, &t.Type, &t.Title, &t.Body, &t.AreaID, &t.AreaName, &assignees, &creatorID, &creatorName, &t.Size, &t.Goal, &t.EstPages, &t.Status, &t.Round, &t.Version, &t.Approved, &t.CreatedAt, &t.UpdatedAt, &t.StatusChangedAt, &t.CommentCount); e != nil {
		return t, e
	}
	if e := json.Unmarshal(assignees, &t.Assignees); e != nil {
		return t, e
	}
	t.CreatedBy = UserRef{creatorID, creatorName}
	t.Reviews = []TicketReview{}
	return t, nil
}

// loadTicket reads one ticket with its current-round reviews. With lock the row is locked first,
// so concurrent actions on the same ticket serialize and read the committed state afterwards.
func loadTicket(ctx context.Context, db DB, id string, lock bool) (Ticket, error) {
	if !validID(id) {
		return Ticket{}, missing()
	}
	if lock {
		var one int
		if e := db.QueryRow(ctx, "SELECT 1 FROM tickets WHERE id=$1 FOR UPDATE", id).Scan(&one); e != nil {
			return Ticket{}, e
		}
	}
	t, e := scanTicket(db.QueryRow(ctx, "SELECT "+ticketCols+" FROM ("+ticketInner+" WHERE t.id=$1) x", id))
	if e != nil {
		return t, e
	}
	list := []Ticket{t}
	if e = attachReviews(ctx, db, list); e != nil {
		return t, e
	}
	return list[0], nil
}

func attachReviews(ctx context.Context, db DB, tickets []Ticket) error {
	if len(tickets) == 0 {
		return nil
	}
	ids := make([]string, len(tickets))
	index := map[string]int{}
	for i, t := range tickets {
		ids[i] = t.ID
		index[t.ID] = i
	}
	rows, e := db.Query(ctx, `SELECT r.ticket_id::text,r.user_id::text,u.name,r.verdict,r.binding,r.self_confirmed,r.updated_at
 FROM ticket_reviews r JOIN tickets t ON t.id=r.ticket_id AND r.round=t.round JOIN users u ON u.id=r.user_id
 WHERE r.ticket_id=ANY($1::uuid[]) ORDER BY r.updated_at,r.user_id`, ids)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var ticketID string
		var v TicketReview
		if e = rows.Scan(&ticketID, &v.User.ID, &v.User.Name, &v.Verdict, &v.Binding, &v.SelfConfirmed, &v.UpdatedAt); e != nil {
			return e
		}
		i := index[ticketID]
		tickets[i].Reviews = append(tickets[i].Reviews, v)
	}
	return rows.Err()
}

// isAreaReviewer: default reviewer of the area and currently an admitted manager/admin.
func isAreaReviewer(ctx context.Context, db DB, areaID, userID string) (bool, error) {
	var ok bool
	e := db.QueryRow(ctx, "SELECT "+reviewerPredicate, areaID, userID).Scan(&ok)
	return ok, e
}

// canManageTicketArea: admins and the area's default reviewers.
func canManageTicketArea(ctx context.Context, db DB, u User, areaID string) (bool, error) {
	if u.Role == "admin" {
		return true, nil
	}
	return isAreaReviewer(ctx, db, areaID, u.ID)
}

// requireEditorUser checks that the id names a currently admitted manager or admin (row-locked for the transaction).
func requireEditorUser(ctx context.Context, db DB, id, message string) error {
	if !validID(id) {
		return bad(message)
	}
	var one int
	e := db.QueryRow(ctx, "SELECT 1 FROM users WHERE id=$1 AND admitted AND role IN ('manager','admin') FOR SHARE", id).Scan(&one)
	if errors.Is(e, pgx.ErrNoRows) {
		return bad(message)
	}
	return e
}

// userNames renders a set of people for the timeline ("niemand" when empty).
func userNames(ctx context.Context, db DB, ids []string) string {
	if len(ids) == 0 {
		return "niemand"
	}
	var names string
	if e := db.QueryRow(ctx, "SELECT string_agg(name,', ' ORDER BY name) FROM users WHERE id=ANY($1::uuid[])", ids).Scan(&names); e != nil {
		return "unbekannt"
	}
	return names
}

func assigneeIDs(t Ticket) []string {
	ids := make([]string, len(t.Assignees))
	for i, a := range t.Assignees {
		ids[i] = a.ID
	}
	slices.Sort(ids)
	return ids
}

func isTicketAssignee(t Ticket, userID string) bool {
	return slices.ContainsFunc(t.Assignees, func(a UserRef) bool { return a.ID == userID })
}

// setAssignees replaces the assignee set; ids new to the ticket must be admitted managers/admins.
func setAssignees(ctx context.Context, db DB, ticketID string, before, after []string) error {
	for _, id := range after {
		if !slices.Contains(before, id) {
			if e := requireEditorUser(ctx, db, id, noAssigneeMessage); e != nil {
				return e
			}
		}
	}
	if _, e := db.Exec(ctx, "INSERT INTO ticket_former_assignees(ticket_id,user_id) SELECT ticket_id,user_id FROM ticket_assignees WHERE ticket_id=$1 AND NOT user_id=ANY($2::uuid[]) ON CONFLICT DO NOTHING", ticketID, after); e != nil {
		return e
	}
	if _, e := db.Exec(ctx, "DELETE FROM ticket_assignees WHERE ticket_id=$1", ticketID); e != nil {
		return e
	}
	_, e := db.Exec(ctx, "INSERT INTO ticket_assignees(ticket_id,user_id) SELECT $1,unnest($2::uuid[])", ticketID, after)
	return e
}

func addTicketEvent(ctx context.Context, db DB, ticketID, actorID, kind, body, detail string) error {
	_, e := db.Exec(ctx, "INSERT INTO ticket_events(id,ticket_id,actor_id,kind,body,detail) VALUES($1,$2,$3,$4,$5,$6)", ID(), ticketID, actorID, kind, body, detail)
	return e
}

func ticketActor(r *http.Request) (User, error) {
	u := current(r)
	if !editor(u) {
		return u, forbidden()
	}
	return u, nil
}

// ticketShape holds the fields that decide whether a ticket starts a new review round.
type ticketShape struct {
	Status, AreaID, Size string
	Assignees            []string // sorted
	EstPages             *int
}

func shapeOf(t Ticket) ticketShape {
	return ticketShape{Status: t.Status, AreaID: t.AreaID, Size: t.Size, Assignees: assigneeIDs(t), EstPages: t.EstPages}
}

func samePtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// startsNewRound is the single round rule shared by edit, status and claim: earlier votes stop counting when
// the ticket returns from review/done to todo/in_progress or when area, assignee, size or est_pages change.
func startsNewRound(before, after ticketShape) bool {
	if (before.Status == "review" || before.Status == "done") && (after.Status == "todo" || after.Status == "in_progress") {
		return true
	}
	return before.AreaID != after.AreaID || before.Size != after.Size || !slices.Equal(before.Assignees, after.Assignees) || !samePtr(before.EstPages, after.EstPages)
}

type ticketFields struct {
	Title, Body, AreaID, Size, Goal string
	AssigneeIDs                     []string
	EstPages                        *int
}

const maxTicketAssignees = 20

// normalize trims and validates the user-supplied fields; typ decides the est_pages rule.
func (f *ticketFields) normalize(typ string) error {
	f.Title = strings.TrimSpace(f.Title)
	f.Goal = strings.TrimSpace(f.Goal)
	if f.Title == "" || utf8.RuneCountInString(f.Title) > 200 {
		return bad("Titel erforderlich (max. 200 Zeichen).")
	}
	if f.Goal == "" || utf8.RuneCountInString(f.Goal) > 1000 {
		return bad("Zieldefinition erforderlich (max. 1000 Zeichen).")
	}
	if utf8.RuneCountInString(f.Body) > 50000 {
		return bad("Beschreibung zu lang (max. 50000 Zeichen).")
	}
	if strings.ContainsRune(f.Title+f.Goal+f.Body, 0) {
		return bad("Ungültige Zeichen.")
	}
	if !ticketSizes[f.Size] {
		return bad("Größe erforderlich (XS bis XL).")
	}
	if !validID(f.AreaID) {
		return bad("Bereich erforderlich.")
	}
	if len(f.AssigneeIDs) > maxTicketAssignees {
		return bad(fmt.Sprintf("Höchstens %d zuständige Personen.", maxTicketAssignees))
	}
	for i, id := range f.AssigneeIDs {
		f.AssigneeIDs[i] = strings.ToLower(id)
		if !validID(id) {
			return bad("Ungültige zuständige Person.")
		}
	}
	// Sorted and duplicate-free, so set comparisons are plain slice comparisons.
	f.AssigneeIDs = slices.Compact(slices.Sorted(slices.Values(f.AssigneeIDs)))
	if f.AssigneeIDs == nil {
		f.AssigneeIDs = []string{}
	}
	switch typ {
	case "artikel":
		if f.EstPages == nil || *f.EstPages < 1 || *f.EstPages > maxTicketPages {
			return bad("Geschätzte Seiten (mindestens 1) sind für Artikel erforderlich.")
		}
	case "aufgabe":
		if f.EstPages != nil {
			return bad("Geschätzte Seiten gibt es nur bei Artikeln.")
		}
	default:
		return bad("Ungültiger Typ.")
	}
	return nil
}

func requireArea(ctx context.Context, db DB, areaID string) error {
	var ok bool
	if e := db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM areas WHERE id=$1)", areaID).Scan(&ok); e != nil {
		return e
	}
	if !ok {
		return bad("Unbekannter Bereich.")
	}
	return nil
}

const noAssigneeMessage = "Zuständig können nur freigeschaltete Redaktionsmitglieder sein."

// ---- Areas ----

func loadAreas(ctx context.Context, db DB, id string) ([]Area, error) {
	query := "SELECT id::text,name,position,version FROM areas"
	args := []any{}
	if id != "" {
		query += " WHERE id=$1"
		args = append(args, id)
	}
	rows, e := db.Query(ctx, query+" ORDER BY position,name", args...)
	if e != nil {
		return nil, e
	}
	out := []Area{}
	index := map[string]int{}
	for rows.Next() {
		v := Area{Reviewers: []UserRef{}}
		if e = rows.Scan(&v.ID, &v.Name, &v.Position, &v.Version); e != nil {
			rows.Close()
			return nil, e
		}
		index[v.ID] = len(out)
		out = append(out, v)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return nil, e
	}
	reviewers, e := db.Query(ctx, "SELECT ar.area_id::text,u.id::text,u.name FROM area_reviewers ar JOIN users u ON u.id=ar.user_id WHERE u.admitted AND u.role IN ('manager','admin') ORDER BY u.name,u.id")
	if e != nil {
		return nil, e
	}
	defer reviewers.Close()
	for reviewers.Next() {
		var areaID string
		var ref UserRef
		if e = reviewers.Scan(&areaID, &ref.ID, &ref.Name); e != nil {
			return nil, e
		}
		if i, ok := index[areaID]; ok {
			out[i].Reviewers = append(out[i].Reviewers, ref)
		}
	}
	return out, reviewers.Err()
}

func (a *App) listAreas(w http.ResponseWriter, r *http.Request) error {
	if _, e := ticketActor(r); e != nil {
		return e
	}
	out, e := loadAreas(r.Context(), a.DB, "")
	if e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}

// checkReviewerIDs requires a duplicate-free list of currently admitted managers/admins.
func checkReviewerIDs(ctx context.Context, db DB, ids []string) error {
	if len(ids) > 100 {
		return bad("Zu viele Verantwortliche.")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !validID(id) || seen[id] {
			return bad("Ungültige oder doppelte verantwortliche Person.")
		}
		seen[id] = true
		if e := requireEditorUser(ctx, db, id, "Verantwortliche müssen freigeschaltete Redaktionsmitglieder sein."); e != nil {
			return e
		}
	}
	return nil
}

func replaceReviewers(ctx context.Context, db DB, areaID string, ids []string) error {
	if _, e := db.Exec(ctx, "DELETE FROM area_reviewers WHERE area_id=$1", areaID); e != nil {
		return e
	}
	for _, id := range ids {
		if _, e := db.Exec(ctx, "INSERT INTO area_reviewers(area_id,user_id) VALUES($1,$2)", areaID, id); e != nil {
			return e
		}
	}
	return nil
}

func areaName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 100 || strings.ContainsRune(name, 0) {
		return "", bad("Name erforderlich (max. 100 Zeichen).")
	}
	return name, nil
}

func (a *App) createArea(w http.ResponseWriter, r *http.Request) error {
	actor := current(r)
	if actor.Role != "admin" {
		return forbidden()
	}
	var in struct {
		Name        string   `json:"name"`
		ReviewerIDs []string `json:"reviewer_ids"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	name, e := areaName(in.Name)
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(74120991)"); e != nil {
		return e
	}
	if e = checkReviewerIDs(r.Context(), tx, in.ReviewerIDs); e != nil {
		return e
	}
	id := ID()
	if _, e = tx.Exec(r.Context(), "INSERT INTO areas(id,name,position) VALUES($1,$2,(SELECT COALESCE(max(position),0)+1 FROM areas))", id, name); e != nil {
		return e
	}
	if e = replaceReviewers(r.Context(), tx, id, in.ReviewerIDs); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, actor, "area.created", id); e != nil {
		return e
	}
	list, e := loadAreas(r.Context(), tx, id)
	if e != nil || len(list) != 1 {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 201, list[0])
	return nil
}

func (a *App) editArea(w http.ResponseWriter, r *http.Request) error {
	actor := current(r)
	if actor.Role != "admin" {
		return forbidden()
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in struct {
		Name        string   `json:"name"`
		ReviewerIDs []string `json:"reviewer_ids"`
		Version     int      `json:"version"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	name, e := areaName(in.Name)
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var version int
	if e = tx.QueryRow(r.Context(), "SELECT version FROM areas WHERE id=$1 FOR UPDATE", id).Scan(&version); e != nil {
		return e
	}
	if version != in.Version {
		return conflict()
	}
	if e = checkReviewerIDs(r.Context(), tx, in.ReviewerIDs); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE areas SET name=$2,version=version+1 WHERE id=$1", id, name); e != nil {
		return e
	}
	if e = replaceReviewers(r.Context(), tx, id, in.ReviewerIDs); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, actor, "area.updated", id); e != nil {
		return e
	}
	list, e := loadAreas(r.Context(), tx, id)
	if e != nil || len(list) != 1 {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, list[0])
	return nil
}

// ---- Tickets ----

// ticketPeople lists everyone who can work on tickets (admitted managers and admins), for the "Wer" picker.
func (a *App) ticketPeople(w http.ResponseWriter, r *http.Request) error {
	if _, e := ticketActor(r); e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT id::text,name FROM users WHERE admitted AND role IN ('manager','admin') ORDER BY name,id")
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []UserRef{}
	for rows.Next() {
		var v UserRef
		if e = rows.Scan(&v.ID, &v.Name); e != nil {
			return e
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}

func (a *App) listTickets(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	q := r.URL.Query()
	args := []any{}
	where := []string{}
	add := func(condition string, value any) {
		args = append(args, value)
		where = append(where, strings.ReplaceAll(condition, "?", fmt.Sprintf("$%d", len(args))))
	}
	if v := q.Get("area"); v != "" {
		if !validID(v) {
			return bad("Ungültiger Bereich.")
		}
		add("area_id=?", v)
	}
	if v := q.Get("assignee"); v != "" {
		if v == "me" {
			v = u.ID
		}
		if !validID(v) {
			return bad("Ungültige zuständige Person.")
		}
		add("EXISTS(SELECT 1 FROM ticket_assignees ta WHERE ta.ticket_id=x.id AND ta.user_id=?)", v)
	}
	if v := q.Get("type"); v != "" {
		if v != "aufgabe" && v != "artikel" {
			return bad("Ungültiger Typ.")
		}
		add("type=?", v)
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		if utf8.RuneCountInString(v) > 200 || strings.ContainsRune(v, 0) {
			return bad("Suchbegriff zu lang.")
		}
		escaped := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(v)
		args = append(args, "%"+escaped+"%")
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR goal ILIKE $%d)", len(args), len(args)))
	}
	if v := q.Get("include_finished"); v != "true" && v != "1" {
		where = append(where, "NOT (status='done' AND approved)")
	}
	query := "SELECT " + ticketCols + " FROM (" + ticketInner + ") x"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	rows, e := a.DB.Query(r.Context(), query+" ORDER BY updated_at DESC,number DESC", args...)
	if e != nil {
		return e
	}
	out := []Ticket{}
	for rows.Next() {
		t, e := scanTicket(rows)
		if e != nil {
			rows.Close()
			return e
		}
		out = append(out, t)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return e
	}
	if e = attachReviews(r.Context(), a.DB, out); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}

func (a *App) getTicket(w http.ResponseWriter, r *http.Request) error {
	if _, e := ticketActor(r); e != nil {
		return e
	}
	t, e := loadTicket(r.Context(), a.DB, r.PathValue("id"), false)
	if e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT e.id::text,e.kind,e.actor_id::text,u.name,e.body,e.detail,e.created_at FROM ticket_events e JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at,e.id", t.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	events := []TicketEvent{}
	for rows.Next() {
		var v TicketEvent
		if e = rows.Scan(&v.ID, &v.Kind, &v.Actor.ID, &v.Actor.Name, &v.Body, &v.Detail, &v.CreatedAt); e != nil {
			return e
		}
		events = append(events, v)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, TicketDetail{Ticket: t, Events: events})
	return nil
}

func (a *App) createTicket(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	var in struct {
		Type        string   `json:"type"`
		Title       string   `json:"title"`
		Body        string   `json:"body"`
		AreaID      string   `json:"area_id"`
		AssigneeIDs []string `json:"assignee_ids"`
		Size        string   `json:"size"`
		Goal        string   `json:"goal"`
		EstPages    *int     `json:"est_pages"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	f := ticketFields{Title: in.Title, Body: in.Body, AreaID: in.AreaID, Size: in.Size, Goal: in.Goal, AssigneeIDs: in.AssigneeIDs, EstPages: in.EstPages}
	if e = f.normalize(in.Type); e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if e = requireArea(r.Context(), tx, f.AreaID); e != nil {
		return e
	}
	// Any editor may assign any admitted editors (or nobody); the Bereich alone decides who reviews.
	status := "todo"
	if len(f.AssigneeIDs) > 0 {
		status = "in_progress"
	}
	id := ID()
	if _, e = tx.Exec(r.Context(), "INSERT INTO tickets(id,type,title,body,area_id,created_by,size,goal,est_pages,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
		id, in.Type, f.Title, f.Body, f.AreaID, u.ID, f.Size, f.Goal, f.EstPages, status); e != nil {
		return e
	}
	if len(f.AssigneeIDs) > 0 {
		if e = setAssignees(r.Context(), tx, id, nil, f.AssigneeIDs); e != nil {
			return e
		}
		if e = addTicketEvent(r.Context(), tx, id, u.ID, "assign", "", "niemand -> "+userNames(r.Context(), tx, f.AssigneeIDs)); e != nil {
			return e
		}
	}
	if e = audit(r.Context(), tx, u, "ticket.created", id); e != nil {
		return e
	}
	t, e := loadTicket(r.Context(), tx, id, false)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 201, t)
	return nil
}

// editTicket applies a full replace of the editable fields (type is immutable). Area reviewers and admins may change
// anything. An assignee may change only the assignee set (to any admitted editors), and only while the ticket is
// todo/in_progress: in review a changed set would change which votes bind (rule 2) without a reviewer's action.
// Emptying the set of an in_progress ticket returns it to todo.
func (a *App) editTicket(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in struct {
		Title       string   `json:"title"`
		Body        string   `json:"body"`
		AreaID      string   `json:"area_id"`
		AssigneeIDs []string `json:"assignee_ids"`
		Size        string   `json:"size"`
		Goal        string   `json:"goal"`
		EstPages    *int     `json:"est_pages"`
		Version     int      `json:"version"`
	}
	// PATCH is a full replace: every key must be present (null is allowed only for est_pages), so a partial body
	// can never silently blank a field or drop the assignees.
	var raw map[string]json.RawMessage
	if e = decode(w, r, &raw); e != nil {
		return e
	}
	for _, key := range []string{"title", "body", "area_id", "assignee_ids", "size", "goal", "est_pages", "version"} {
		if _, ok := raw[key]; !ok {
			return bad("Pflichtfeld fehlt: " + key + ".")
		}
	}
	if strings.TrimSpace(string(raw["assignee_ids"])) == "null" {
		return bad("assignee_ids muss eine Liste sein.")
	}
	if len(raw) != 8 {
		return bad("Unbekannte Felder.")
	}
	encoded, e := json.Marshal(raw)
	if e != nil {
		return e
	}
	if json.Unmarshal(encoded, &in) != nil {
		return bad("Ungültige JSON-Daten.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	t, e := loadTicket(r.Context(), tx, id, true)
	if e != nil {
		return e
	}
	isAssignee := isTicketAssignee(t, u.ID)
	manage, e := canManageTicketArea(r.Context(), tx, u, t.AreaID)
	if e != nil {
		return e
	}
	if !manage && !isAssignee {
		return forbidden()
	}
	f := ticketFields{Title: in.Title, Body: in.Body, AreaID: in.AreaID, Size: in.Size, Goal: in.Goal, AssigneeIDs: in.AssigneeIDs, EstPages: in.EstPages}
	if e = f.normalize(t.Type); e != nil {
		return e
	}
	if t.Version != in.Version {
		return conflict()
	}
	before := shapeOf(t)
	assigneesChanged := !slices.Equal(f.AssigneeIDs, before.Assignees)
	if !manage {
		unchanged := f.Title == t.Title && f.Body == t.Body && f.AreaID == t.AreaID && f.Size == t.Size && f.Goal == t.Goal && samePtr(f.EstPages, t.EstPages)
		if !unchanged {
			return fail(403, "forbidden", "Als zuständige Person kannst du nur ändern, wer am Ticket arbeitet.")
		}
		if assigneesChanged && t.Status != "todo" && t.Status != "in_progress" {
			return fail(403, "forbidden", "In Review oder Fertig ändern nur Bereichsverantwortliche, wer am Ticket arbeitet.")
		}
	}
	if f.AreaID != t.AreaID {
		if e = requireArea(r.Context(), tx, f.AreaID); e != nil {
			return e
		}
		// Moving a ticket needs authority over the destination Bereich as well.
		destination, e := canManageTicketArea(r.Context(), tx, u, f.AreaID)
		if e != nil {
			return e
		}
		if !destination {
			return forbidden()
		}
	}
	status := t.Status
	if len(f.AssigneeIDs) == 0 && t.Status == "in_progress" {
		status = "todo"
	}
	after := ticketShape{Status: status, AreaID: f.AreaID, Size: f.Size, Assignees: f.AssigneeIDs, EstPages: f.EstPages}
	changed := []string{}
	for _, c := range []struct {
		name string
		diff bool
	}{{"title", f.Title != t.Title}, {"body", f.Body != t.Body}, {"area_id", f.AreaID != t.AreaID}, {"size", f.Size != t.Size}, {"goal", f.Goal != t.Goal}, {"est_pages", !samePtr(f.EstPages, t.EstPages)}} {
		if c.diff {
			changed = append(changed, c.name)
		}
	}
	if len(changed) == 0 && !assigneesChanged && status == t.Status {
		jsonOut(w, 200, t)
		return nil
	}
	round := t.Round
	if startsNewRound(before, after) {
		round++
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tickets SET title=$2,body=$3,area_id=$4,size=$5,goal=$6,est_pages=$7,status=$8,round=$9,version=version+1,updated_at=now(),status_changed_at=CASE WHEN status<>$8 THEN now() ELSE status_changed_at END WHERE id=$1",
		t.ID, f.Title, f.Body, f.AreaID, f.Size, f.Goal, f.EstPages, status, round); e != nil {
		return e
	}
	if assigneesChanged {
		if e = setAssignees(r.Context(), tx, t.ID, before.Assignees, f.AssigneeIDs); e != nil {
			return e
		}
	}
	if len(changed) > 0 {
		if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "edit", "", strings.Join(changed, ",")); e != nil {
			return e
		}
	}
	if assigneesChanged {
		detail := userNames(r.Context(), tx, before.Assignees) + " -> " + userNames(r.Context(), tx, after.Assignees)
		if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "assign", "", detail); e != nil {
			return e
		}
	}
	if status != t.Status {
		if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "status", "", t.Status+"->"+status); e != nil {
			return e
		}
	}
	if e = audit(r.Context(), tx, u, "ticket.updated", t.ID); e != nil {
		return e
	}
	return a.finishTicket(w, r, tx, t.ID, 200)
}

func (a *App) finishTicket(w http.ResponseWriter, r *http.Request, tx pgx.Tx, id string, status int) error {
	t, e := loadTicket(r.Context(), tx, id, false)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, status, t)
	return nil
}

func (a *App) ticketStatus(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in TicketStatusInput
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if !ticketStatuses[in.Status] {
		return bad("Ungültiger Status.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	t, e := loadTicket(r.Context(), tx, id, true)
	if e != nil {
		return e
	}
	manage, e := canManageTicketArea(r.Context(), tx, u, t.AreaID)
	if e != nil {
		return e
	}
	if !manage && !isTicketAssignee(t, u.ID) {
		return forbidden()
	}
	if t.Version != in.Version || t.Status == in.Status {
		return conflict()
	}
	before := shapeOf(t)
	after := before
	after.Status = in.Status
	round := t.Round
	if startsNewRound(before, after) {
		round++
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tickets SET status=$2,round=$3,version=version+1,updated_at=now(),status_changed_at=now() WHERE id=$1", t.ID, in.Status, round); e != nil {
		return e
	}
	if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "status", "", t.Status+"->"+in.Status); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "ticket.status", t.ID); e != nil {
		return e
	}
	return a.finishTicket(w, r, tx, t.ID, 200)
}

// claimTicket adds the caller to the assignees of open work ("Übernehmen" / "Mitmachen"). The row lock serializes
// concurrent claims; claiming twice is 409.
func (a *App) claimTicket(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
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
	t, e := loadTicket(r.Context(), tx, id, true)
	if e != nil {
		return e
	}
	// Only open work can be claimed: claiming a done or in-review ticket would reopen it and drop its approval.
	if isTicketAssignee(t, u.ID) || (t.Status != "todo" && t.Status != "in_progress") {
		return conflict()
	}
	if len(t.Assignees) >= maxTicketAssignees {
		return bad(fmt.Sprintf("Höchstens %d zuständige Personen.", maxTicketAssignees))
	}
	before := shapeOf(t)
	after := before
	after.Status = "in_progress"
	after.Assignees = slices.Sorted(slices.Values(append(slices.Clone(before.Assignees), u.ID)))
	round := t.Round
	if startsNewRound(before, after) {
		round++
	}
	if _, e = tx.Exec(r.Context(), "INSERT INTO ticket_assignees(ticket_id,user_id) VALUES($1,$2)", t.ID, u.ID); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tickets SET status='in_progress',round=$2,version=version+1,updated_at=now(),status_changed_at=CASE WHEN status<>'in_progress' THEN now() ELSE status_changed_at END WHERE id=$1", t.ID, round); e != nil {
		return e
	}
	if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "assign", "", userNames(r.Context(), tx, before.Assignees)+" -> "+userNames(r.Context(), tx, after.Assignees)); e != nil {
		return e
	}
	if t.Status != "in_progress" {
		if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "status", "", t.Status+"->in_progress"); e != nil {
			return e
		}
	}
	if e = audit(r.Context(), tx, u, "ticket.claimed", t.ID); e != nil {
		return e
	}
	return a.finishTicket(w, r, tx, t.ID, 200)
}

func (a *App) commentTicket(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in CommentInput
	if e = decode(w, r, &in); e != nil {
		return e
	}
	body := strings.TrimSpace(in.Body)
	if body == "" || utf8.RuneCountInString(body) > 10000 || strings.ContainsRune(body, 0) {
		return bad("Kommentar erforderlich (max. 10000 Zeichen).")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	t, e := loadTicket(r.Context(), tx, id, true)
	if e != nil {
		return e
	}
	event := TicketEvent{ID: ID(), Kind: "comment", Actor: UserRef{u.ID, u.Name}, Body: body}
	if e = tx.QueryRow(r.Context(), "INSERT INTO ticket_events(id,ticket_id,actor_id,kind,body,detail) VALUES($1,$2,$3,'comment',$4,'') RETURNING created_at", event.ID, t.ID, u.ID, body).Scan(&event.CreatedAt); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tickets SET updated_at=now() WHERE id=$1", t.ID); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "ticket.commented", t.ID); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 201, event)
	return nil
}

// reviewTicket upserts the caller's vote for the current round. Votes outside review/done are 409; a vote by the
// assignee (any verdict) that does not meet rule 3 is 403. Binding is computed inside the ticket lock and fixed at vote time.
func (a *App) reviewTicket(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in struct {
		Verdict       string `json:"verdict"`
		Round         *int   `json:"round"`
		SelfConfirmed bool   `json:"self_confirmed"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if in.Verdict != "approve" && in.Verdict != "changes" {
		return bad("Ungültiges Votum.")
	}
	if in.Round == nil || *in.Round < 1 {
		return bad("Die Runde des Tickets ist erforderlich.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	t, e := loadTicket(r.Context(), tx, id, true)
	if e != nil {
		return e
	}
	// The vote was cast against a round the ticket has since left: it must never count in the new round.
	if *in.Round != t.Round || (t.Status != "review" && t.Status != "done") {
		return conflict()
	}
	voterReviewer, e := isAreaReviewer(r.Context(), tx, t.AreaID, u.ID)
	if e != nil {
		return e
	}
	binding, selfConfirmed := false, false
	if isTicketAssignee(t, u.ID) {
		// Rule 3: self approval only for the sole assignee who is a default reviewer, with explicit confirmation, XS/S
		// and type aufgabe. A co-assigned colleague did part of the work and must not approve it alone.
		if len(t.Assignees) != 1 || !voterReviewer || !in.SelfConfirmed || (t.Size != "XS" && t.Size != "S") || t.Type != "aufgabe" {
			return fail(403, "forbidden", "Eigene Aufgaben darf nur die allein zuständige bereichsverantwortliche Person bei bestätigter Selbstfreigabe (Aufgabe, Größe XS/S) bewerten.")
		}
		binding, selfConfirmed = true, true
	} else {
		binding = voterReviewer // rule 1
		// Rule 2: every assignee is a default reviewer, so no reviewer is left to vote and any other manager/admin is
		// binding. "Every" keeps co-assigning from switching this on, and a former assignee never counts: whoever
		// worked on the ticket cannot leave it to a reviewer and then approve their own work.
		if !binding && len(t.Assignees) > 0 {
			var former bool
			if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM ticket_former_assignees WHERE ticket_id=$1 AND user_id=$2)", t.ID, u.ID).Scan(&former); e != nil {
				return e
			}
			binding = !former
			for _, a := range t.Assignees {
				ok, e := isAreaReviewer(r.Context(), tx, t.AreaID, a.ID)
				if e != nil {
					return e
				}
				binding = binding && ok
			}
		}
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO ticket_reviews(ticket_id,user_id,round,verdict,binding,self_confirmed) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(ticket_id,user_id,round) DO UPDATE SET verdict=EXCLUDED.verdict,binding=EXCLUDED.binding,self_confirmed=EXCLUDED.self_confirmed,updated_at=now()`, t.ID, u.ID, t.Round, in.Verdict, binding, selfConfirmed); e != nil {
		return e
	}
	detail := in.Verdict
	if binding {
		detail += ":binding"
	}
	if e = addTicketEvent(r.Context(), tx, t.ID, u.ID, "review", "", detail); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tickets SET updated_at=now() WHERE id=$1", t.ID); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "ticket.reviewed", t.ID); e != nil {
		return e
	}
	return a.finishTicket(w, r, tx, t.ID, 200)
}
