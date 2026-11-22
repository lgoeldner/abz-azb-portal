package portal

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Shared Redaktion documents (PROJECT_MANAGEMENT feature). Managers and admins read and edit every document;
// there is no per-document ACL. Contract: docs/implementation-contract.md ("Documents").

// docSelect reads documents with the caller ($1) as reader: a document is unread when someone else changed it
// after the caller last opened it, or the caller never opened it.
const docSelect = `SELECT d.id::text,d.title,d.kind,d.body,d.created_by::text,cb.name,d.updated_by::text,ub.name,d.version,d.created_at,d.updated_at,
 (d.updated_by<>$1::uuid AND NOT EXISTS(SELECT 1 FROM document_views v WHERE v.document_id=d.id AND v.user_id=$1::uuid AND v.viewed_at>=d.updated_at)) AS unread
 FROM documents d JOIN users cb ON cb.id=d.created_by JOIN users ub ON ub.id=d.updated_by`

func scanDocument(row scanner) (Document, error) {
	var d Document
	e := row.Scan(&d.ID, &d.Title, &d.Kind, &d.Body, &d.CreatedBy.ID, &d.CreatedBy.Name, &d.UpdatedBy.ID, &d.UpdatedBy.Name, &d.Version, &d.CreatedAt, &d.UpdatedAt, &d.Unread)
	return d, e
}

func loadDocument(ctx context.Context, db DB, reader, id string) (Document, error) {
	return scanDocument(db.QueryRow(ctx, docSelect+" WHERE d.id=$2", reader, id))
}

func documentFields(title, kind, body string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 200 {
		return "", bad("Titel: 1 bis 200 Zeichen.")
	}
	if kind != "meeting" && kind != "note" {
		return "", bad("Art: Treffen oder Notiz.")
	}
	if utf8.RuneCountInString(body) > 100000 {
		return "", bad("Text: höchstens 100000 Zeichen.")
	}
	if strings.ContainsRune(title+body, 0) {
		return "", bad("Ungültige Zeichen.")
	}
	return title, nil
}

// markViewed records that the caller has seen the document in its current state.
func markViewed(ctx context.Context, db DB, userID, id string) error {
	_, e := db.Exec(ctx, "INSERT INTO document_views(document_id,user_id,viewed_at) VALUES($1,$2,now()) ON CONFLICT(user_id,document_id) DO UPDATE SET viewed_at=now()", id, userID)
	return e
}

func (a *App) listDocuments(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	rows, e := a.DB.Query(r.Context(), docSelect+" ORDER BY d.updated_at DESC, d.id", u.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	list := []Document{}
	for rows.Next() {
		d, e := scanDocument(rows)
		if e != nil {
			return e
		}
		list = append(list, d)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, list)
	return nil
}

func (a *App) createDocument(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	var in DocumentInput
	if e = decode(w, r, &in); e != nil {
		return e
	}
	title, e := documentFields(in.Title, in.Kind, in.Body)
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	id := ID()
	if _, e = tx.Exec(r.Context(), "INSERT INTO documents(id,title,kind,body,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)", id, title, in.Kind, in.Body, u.ID); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "document.created", id); e != nil {
		return e
	}
	d, e := loadDocument(r.Context(), tx, u.ID, id)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 201, d)
	return nil
}

// getDocument records the caller's view, so reading clears the unread flag.
func (a *App) getDocument(w http.ResponseWriter, r *http.Request) error {
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
	tag, e := tx.Exec(r.Context(), "INSERT INTO document_views(document_id,user_id,viewed_at) SELECT id,$2,now() FROM documents WHERE id=$1 ON CONFLICT(user_id,document_id) DO UPDATE SET viewed_at=now()", id, u.ID)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return missing()
	}
	d, e := loadDocument(r.Context(), tx, u.ID, id)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	d.Unread = false
	jsonOut(w, 200, d)
	return nil
}

func (a *App) editDocument(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in DocumentEdit
	if e = decode(w, r, &in); e != nil {
		return e
	}
	title, e := documentFields(in.Title, in.Kind, in.Body)
	if e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var version int
	if e = tx.QueryRow(r.Context(), "SELECT version FROM documents WHERE id=$1 FOR UPDATE", id).Scan(&version); e != nil {
		return e
	}
	if version != in.Version {
		return conflict()
	}
	if _, e = tx.Exec(r.Context(), "UPDATE documents SET title=$2,kind=$3,body=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1", id, title, in.Kind, in.Body, u.ID); e != nil {
		return e
	}
	if e = markViewed(r.Context(), tx, u.ID, id); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "document.updated", id); e != nil {
		return e
	}
	d, e := loadDocument(r.Context(), tx, u.ID, id)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, d)
	return nil
}

// deleteDocument is limited to the creator and admins, so one manager cannot remove another's notes.
func (a *App) deleteDocument(w http.ResponseWriter, r *http.Request) error {
	u, e := ticketActor(r)
	if e != nil {
		return e
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var in VersionInput
	if e = decode(w, r, &in); e != nil {
		return e
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var creator string
	var version int
	if e = tx.QueryRow(r.Context(), "SELECT created_by::text,version FROM documents WHERE id=$1 FOR UPDATE", id).Scan(&creator, &version); e != nil {
		return e
	}
	if creator != u.ID && u.Role != "admin" {
		return forbidden()
	}
	if version != in.Version {
		return conflict()
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM documents WHERE id=$1", id); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "document.deleted", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
