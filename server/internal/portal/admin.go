package portal

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

func (a *App) users(w http.ResponseWriter, r *http.Request) error {
	if current(r).Role != "admin" {
		return forbidden()
	}
	rows, e := a.DB.Query(r.Context(), "SELECT "+userCols+" FROM users ORDER BY name,id")
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, e := scanUser(rows)
		if e != nil {
			return e
		}
		out = append(out, u)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
func (a *App) deleteUser(w http.ResponseWriter, r *http.Request) error {
	actor := current(r)
	if actor.Role != "admin" {
		return forbidden()
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	if id == actor.ID {
		return fail(409, "self_delete", "Du kannst dich nicht selbst löschen.")
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(74120984)"); e != nil {
		return e
	}
	target, e := scanUser(tx.QueryRow(r.Context(), "SELECT "+userCols+" FROM users WHERE id=$1 FOR UPDATE", id))
	if e != nil {
		return e
	}
	if target.Role == "admin" && target.Admitted {
		var count int
		if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM users WHERE role='admin' AND admitted").Scan(&count); e != nil {
			return e
		}
		if count <= 1 {
			return fail(409, "last_admin", "Die letzte zugelassene Administration kann nicht entfernt werden.")
		}
	}
	var used bool
	if e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM submissions WHERE author_id=$1)
 OR EXISTS(SELECT 1 FROM revisions WHERE actor_id=$1)
 OR EXISTS(SELECT 1 FROM corrections WHERE author_id=$1)
 OR EXISTS(SELECT 1 FROM ballots WHERE user_id=$1)
 OR EXISTS(SELECT 1 FROM ballot_audit WHERE user_id=$1)
 OR EXISTS(SELECT 1 FROM audit_events WHERE actor_id=$1)
 OR EXISTS(SELECT 1 FROM poll_options WHERE user_id=$1)`, id).Scan(&used); e != nil {
		return e
	}
	if used {
		return fail(409, "has_content", "Die Person hat bereits Beiträge, Stimmen oder Aktivitäten und kann nicht gelöscht werden. Zugang stattdessen sperren.")
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "DELETE FROM users WHERE id=$1", id); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, actor, "user.deleted", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	w.WriteHeader(204)
	return nil
}
func (a *App) editUser(w http.ResponseWriter, r *http.Request) error {
	actor := current(r)
	if actor.Role != "admin" {
		return forbidden()
	}
	var in struct {
		Name         string   `json:"name"`
		Role         string   `json:"role"`
		Admitted     bool     `json:"admitted"`
		CohortMember bool     `json:"cohort_member"`
		CategoryIDs  []string `json:"category_ids"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 200 {
		return bad("Name erforderlich (max. 200 Zeichen).")
	}
	if in.Role != "student" && in.Role != "manager" && in.Role != "admin" {
		return bad("Ungültige Rolle.")
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	if in.CategoryIDs == nil {
		in.CategoryIDs = []string{}
	}
	if len(in.CategoryIDs) > 1000 {
		return bad("Zu viele Kategoriezuweisungen.")
	}
	seen := map[string]bool{}
	for _, cid := range in.CategoryIDs {
		if !validID(cid) || seen[cid] {
			return bad("Ungültige oder doppelte Kategoriezuweisung.")
		}
		seen[cid] = true
	}
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(74120984)"); e != nil {
		return e
	}
	original, e := scanUser(tx.QueryRow(r.Context(), "SELECT "+userCols+" FROM users WHERE id=$1 FOR UPDATE", id))
	if e != nil {
		return e
	}
	if original.Role == "admin" && original.Admitted && (in.Role != "admin" || !in.Admitted) {
		var count int
		if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM users WHERE role='admin' AND admitted").Scan(&count); e != nil {
			return e
		}
		if count <= 1 {
			return fail(409, "last_admin", "Die letzte zugelassene Administration kann nicht entfernt werden.")
		}
	}
	for _, cid := range in.CategoryIDs {
		var exists bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1)", cid).Scan(&exists); e != nil {
			return e
		}
		if !exists {
			return bad("Unbekannte Kategoriezuweisung.")
		}
	}
	u, e := scanUser(tx.QueryRow(r.Context(), "UPDATE users SET name=$2,role=$3,admitted=$4,cohort_member=$5,category_ids=$6::uuid[] WHERE id=$1 RETURNING "+userCols, id, in.Name, in.Role, in.Admitted, in.CohortMember, in.CategoryIDs))
	if e != nil {
		return e
	}
	if !in.Admitted {
		if _, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
			return e
		}
	}
	if e = audit(r.Context(), tx, actor, "user.updated", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	jsonOut(w, 200, u)
	return nil
}
func (a *App) auditEvents(w http.ResponseWriter, r *http.Request) error {
	if current(r).Role != "admin" {
		return forbidden()
	}
	rows, e := a.DB.Query(r.Context(), "SELECT a.id::text,u.name,a.action,a.entity_id::text,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id LIMIT 200")
	if e != nil {
		return e
	}
	defer rows.Close()
	out := []AuditEvent{}
	for rows.Next() {
		var v AuditEvent
		if e = rows.Scan(&v.ID, &v.ActorName, &v.Action, &v.EntityID, &v.CreatedAt); e != nil {
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
func (a *App) systemStatus(w http.ResponseWriter, r *http.Request) error {
	if current(r).Role != "admin" {
		return forbidden()
	}
	var last *time.Time
	stale := true
	if a.Config.BackupStatusFile != "" {
		b, e := os.ReadFile(a.Config.BackupStatusFile)
		if e == nil {
			var status struct {
				LastSuccess time.Time `json:"last_success"`
			}
			if json.Unmarshal(b, &status) == nil && !status.LastSuccess.IsZero() && status.LastSuccess.Before(time.Now().Add(5*time.Minute)) {
				t := status.LastSuccess.UTC()
				last = &t
				stale = time.Since(t) > 26*time.Hour
			}
		}
	}
	size, e := diskBytes(a.Config.UploadDir)
	if e != nil {
		return e
	}
	jsonOut(w, 200, map[string]any{"backup_last_success": last, "backup_stale": stale, "upload_bytes": size})
	return nil
}
