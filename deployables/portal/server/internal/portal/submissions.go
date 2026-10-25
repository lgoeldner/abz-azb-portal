package portal

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

const submissionCols = "s.id::text,s.category_id::text,s.author_id::text,u.name,s.title,s.body,s.context,s.status,s.version,s.created_at,s.updated_at"

func scanSubmission(row pgx.Row) (Submission, error) {
	s := Submission{Attachments: []Attachment{}}
	e := row.Scan(&s.ID, &s.CategoryID, &s.AuthorID, &s.AuthorName, &s.Title, &s.Body, &s.Context, &s.Status, &s.Version, &s.CreatedAt, &s.UpdatedAt)
	return s, e
}
func loadSubmission(ctx context.Context, db DB, id string, lock bool) (Submission, error) {
	if !validID(id) {
		return Submission{}, missing()
	}
	q := "SELECT " + submissionCols + " FROM submissions s JOIN users u ON u.id=s.author_id WHERE s.id=$1"
	if lock {
		q += " FOR UPDATE OF s"
	}
	s, e := scanSubmission(db.QueryRow(ctx, q, id))
	if e != nil {
		return s, e
	}
	rows, e := db.Query(ctx, "SELECT id::text,filename,mime_type,size_bytes FROM attachments WHERE submission_id=$1 AND NOT deleted ORDER BY created_at,id", id)
	if e != nil {
		return s, e
	}
	defer rows.Close()
	for rows.Next() {
		var a Attachment
		if e = rows.Scan(&a.ID, &a.Filename, &a.MimeType, &a.SizeBytes); e != nil {
			return s, e
		}
		a.URL = "/api/v1/attachments/" + a.ID
		a.PreviewURL = a.URL + "/preview"
		s.Attachments = append(s.Attachments, a)
	}
	return s, rows.Err()
}
func readable(ctx context.Context, db DB, id string, u User) (Submission, error) {
	s, e := loadSubmission(ctx, db, id, false)
	if e != nil {
		return s, e
	}
	if !canRead(u, s) {
		return s, missing()
	}
	return s, nil
}
func (a *App) listSubmissions(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	q := r.URL.Query()
	cat, status, search := q.Get("category_id"), q.Get("status"), q.Get("q")
	if cat != "" && !validID(cat) {
		return bad("Ungültige Kategorie.")
	}
	if status != "" && !validSubmissionStatus(status) {
		return bad("Ungültiger Status.")
	}
	if len(search) > 200 {
		return bad("Suchtext zu lang.")
	}
	rows, e := a.DB.Query(r.Context(), "SELECT s.id::text FROM submissions s JOIN users u ON u.id=s.author_id WHERE ($1 OR s.author_id=$2::uuid) AND ($3='' OR s.category_id::text=$3) AND ($4='' OR s.status=$4) AND ($5='' OR s.title ILIKE '%'||$5||'%' OR s.body ILIKE '%'||$5||'%' OR u.name ILIKE '%'||$5||'%') ORDER BY s.updated_at DESC,s.id", editor(u), u.ID, cat, status, search)
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
	out := []Submission{}
	for _, id := range ids {
		s, e := loadSubmission(r.Context(), a.DB, id, false)
		if e != nil {
			return e
		}
		out = append(out, s)
	}
	jsonOut(w, 200, out)
	return nil
}
func (a *App) getSubmission(w http.ResponseWriter, r *http.Request) error {
	s, e := readable(r.Context(), a.DB, r.PathValue("id"), current(r))
	if e != nil {
		return e
	}
	jsonOut(w, 200, s)
	return nil
}

type submissionInput struct {
	Version        int    `json:"version"`
	CategoryID     string `json:"category_id"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	Context        string `json:"context"`
	IdempotencyKey string `json:"idempotency_key"`
}

func validateSubmission(in submissionInput) error {
	if !validID(in.CategoryID) {
		return bad("Kategorie erforderlich.")
	}
	if strings.TrimSpace(in.Title) == "" || len(in.Title) > 300 || len(in.Body) > 100000 || len(in.Context) > 10000 {
		return bad("Titel erforderlich (max. 300 Zeichen); Text oder Kontext zu lang.")
	}
	return nil
}
func (a *App) createSubmission(w http.ResponseWriter, r *http.Request) error {
	var in submissionInput
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if e := validateSubmission(in); e != nil {
		return e
	}
	if len(in.IdempotencyKey) < 8 || len(in.IdempotencyKey) > 200 {
		return bad("Idempotenzschlüssel erforderlich (8–200 Zeichen).")
	}
	u := current(r)
	if e := requireRepeatable(r.Context(), a.DB, in.CategoryID); e != nil {
		return e
	}
	payload, _ := json.Marshal(in)
	hash := digest(string(payload))
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	id := ID()
	tag, e := tx.Exec(r.Context(), "INSERT INTO submissions(id,category_id,author_id,title,body,context,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(author_id,idempotency_key) DO NOTHING", id, in.CategoryID, u.ID, strings.TrimSpace(in.Title), in.Body, in.Context, in.IdempotencyKey, hash)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		var originalHash string
		if e = tx.QueryRow(r.Context(), "SELECT id::text,request_hash FROM submissions WHERE author_id=$1 AND idempotency_key=$2", u.ID, in.IdempotencyKey).Scan(&id, &originalHash); e != nil {
			return e
		}
		if hash != originalHash {
			return conflict()
		}
	}
	s, e := loadSubmission(r.Context(), tx, id, false)
	if e != nil {
		return e
	}
	if tag.RowsAffected() > 0 {
		if e = snapshot(r.Context(), tx, u, s); e != nil {
			return e
		}
		if e = audit(r.Context(), tx, u, "submission.created", id); e != nil {
			return e
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	code := 200
	if tag.RowsAffected() > 0 {
		code = 201
	}
	jsonOut(w, code, s)
	return nil
}
func (a *App) editSubmission(w http.ResponseWriter, r *http.Request) error {
	var in submissionInput
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if e := validateSubmission(in); e != nil {
		return e
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canMutate(u, s) {
		return forbidden()
	}
	if s.Version != in.Version {
		return conflict()
	}
	if in.CategoryID != s.CategoryID {
		if e = requireRepeatable(r.Context(), tx, in.CategoryID); e != nil {
			return e
		}
	}
	if in.CategoryID != s.CategoryID && !(u.ID == s.AuthorID && s.Status == "pending") && !canEdit(u, in.CategoryID) {
		return forbidden()
	}
	_, e = tx.Exec(r.Context(), "UPDATE submissions SET category_id=$2,title=$3,body=$4,context=$5,version=version+1,updated_at=now() WHERE id=$1", s.ID, in.CategoryID, strings.TrimSpace(in.Title), in.Body, in.Context)
	if e != nil {
		return e
	}
	return a.finishSubmission(w, r, tx, u, s.ID, "submission.edited")
}
func validSubmissionStatus(s string) bool {
	return s == "pending" || s == "accepted" || s == "rejected" || s == "withdrawn"
}
func allowedTransition(u User, s Submission, next string) bool {
	if s.AuthorID == u.ID && s.Status == "pending" && next == "withdrawn" {
		return true
	}
	if !canEdit(u, s.CategoryID) {
		return false
	}
	return s.Status == "pending" && (next == "accepted" || next == "rejected") || s.Status != "pending" && next == "pending"
}
func (a *App) statusSubmission(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Version int    `json:"version"`
		Status  string `json:"status"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if !validSubmissionStatus(in.Status) {
		return bad("Ungültiger Status.")
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !(s.AuthorID == u.ID || canEdit(u, s.CategoryID)) {
		return forbidden()
	}
	if s.Version != in.Version || !allowedTransition(u, s, in.Status) {
		return conflict()
	}
	if _, e = tx.Exec(r.Context(), "UPDATE submissions SET status=$2,version=version+1,updated_at=now() WHERE id=$1", s.ID, in.Status); e != nil {
		return e
	}
	return a.finishSubmission(w, r, tx, u, s.ID, "submission.status."+in.Status)
}
func (a *App) finishSubmission(w http.ResponseWriter, r *http.Request, tx pgx.Tx, u User, id, action string) error {
	s, e := loadSubmission(r.Context(), tx, id, false)
	if e != nil {
		return e
	}
	if e = snapshot(r.Context(), tx, u, s); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, action, id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, s)
	return nil
}
func (a *App) revisions(w http.ResponseWriter, r *http.Request) error {
	s, e := readable(r.Context(), a.DB, r.PathValue("id"), current(r))
	if e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT r.id::text,r.version,u.name,r.title,r.body,r.context,r.status,r.created_at FROM revisions r JOIN users u ON u.id=r.actor_id WHERE r.submission_id=$1 ORDER BY r.version DESC", s.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []Revision{}
	for rows.Next() {
		var v Revision
		if e = rows.Scan(&v.ID, &v.Version, &v.ActorName, &v.Title, &v.Body, &v.Context, &v.Status, &v.CreatedAt); e != nil {
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
func (a *App) corrections(w http.ResponseWriter, r *http.Request) error {
	s, e := readable(r.Context(), a.DB, r.PathValue("id"), current(r))
	if e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), "SELECT c.id::text,c.submission_id::text,u.name,c.body,c.created_at,c.resolved FROM corrections c JOIN users u ON u.id=c.author_id WHERE c.submission_id=$1 ORDER BY c.created_at", s.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []Correction{}
	for rows.Next() {
		var c Correction
		if e = rows.Scan(&c.ID, &c.SubmissionID, &c.AuthorName, &c.Body, &c.CreatedAt, &c.Resolved); e != nil {
			return e
		}
		out = append(out, c)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
func (a *App) addCorrection(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Body string `json:"body"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if strings.TrimSpace(in.Body) == "" || len(in.Body) > 10000 {
		return bad("Korrekturtext erforderlich (max. 10000 Zeichen).")
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canEdit(u, s.CategoryID) {
		if s.AuthorID != u.ID {
			return forbidden()
		}
		if s.Status == "pending" {
			return conflict()
		}
	}
	c := Correction{ID: ID(), SubmissionID: s.ID, AuthorName: u.Name, Body: in.Body}
	e = tx.QueryRow(r.Context(), "INSERT INTO corrections(id,submission_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING created_at", c.ID, s.ID, u.ID, c.Body).Scan(&c.CreatedAt)
	if e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "correction.created", s.ID); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 201, c)
	return nil
}
func (a *App) resolveCorrection(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canEdit(u, s.CategoryID) {
		return forbidden()
	}
	id := r.PathValue("correctionID")
	if !validID(id) {
		return missing()
	}
	var c Correction
	e = tx.QueryRow(r.Context(), "UPDATE corrections SET resolved=true WHERE id=$1 AND submission_id=$2 RETURNING id::text,submission_id::text,(SELECT name FROM users WHERE id=author_id),body,created_at,resolved", id, s.ID).Scan(&c.ID, &c.SubmissionID, &c.AuthorName, &c.Body, &c.CreatedAt, &c.Resolved)
	if e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "correction.resolved", s.ID); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, c)
	return nil
}
