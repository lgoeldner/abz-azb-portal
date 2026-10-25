package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestHiddenPollCanReopenWithoutChangingCandidatesBallotsOrTimeline(t *testing.T) {
	app, pool := timelineApp(t)
	body := `{"name":"Hidden people poll","description":"","kind":"person","allow_self_vote":true,"all_people":true,"max_choices":2,"options":[]}`
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)

	var granted bool
	if err := pool.QueryRow(context.Background(), "SELECT $1::uuid=ANY(category_ids) FROM users WHERE id=$2", poll.ID, ManagerID).Scan(&granted); err != nil || !granted {
		t.Fatalf("creator manager did not receive category grant: granted=%v err=%v", granted, err)
	}

	// Change the roster after the draft snapshot. The first opening should pick up
	// this change; later openings must retain the exact first-open candidate set.
	newMember := "00000000-0000-4000-8000-0000000000f8"
	if _, err := pool.Exec(context.Background(), "UPDATE users SET cohort_member=false WHERE id=$1", LeonID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,'new-poll-member','New member','student',true,true)", newMember); err != nil {
		t.Fatal(err)
	}

	status := func(version int, target string, actor string, want int) Category {
		t.Helper()
		res := authenticatedRequest(t, app, pool, actor, http.MethodPost, "/api/v1/categories/"+poll.ID+"/status", fmt.Sprintf(`{"version":%d,"status":%q}`, version, target))
		return decodeCategory(t, res, want)
	}
	opened := status(poll.Version, "open", ManagerID, http.StatusOK)
	if opened.OpenedAt == nil {
		t.Fatal("first opening did not set opened_at")
	}
	firstOptions := append([]PollOption(nil), opened.Options...)
	if len(firstOptions) < 2 {
		t.Fatalf("first opening produced only %d options", len(firstOptions))
	}
	var sawNew, sawLeon bool
	for _, option := range firstOptions {
		if option.UserID != nil && *option.UserID == newMember {
			sawNew = true
		}
		if option.UserID != nil && *option.UserID == LeonID {
			sawLeon = true
		}
	}
	if !sawNew || sawLeon {
		t.Fatalf("first opening did not snapshot the updated roster: new member=%v former member=%v", sawNew, sawLeon)
	}

	firstSelection := []string{firstOptions[0].ID, firstOptions[1].ID}
	secondSelection := []string{firstOptions[1].ID, firstOptions[2].ID}
	vote := func(selection []string) {
		t.Helper()
		encoded, err := json.Marshal(map[string][]string{"option_ids": selection})
		if err != nil {
			t.Fatal(err)
		}
		res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+poll.ID+"/ballot", string(encoded))
		if res.Code != http.StatusOK {
			t.Fatalf("cast ballot returned %d", res.Code)
		}
	}
	vote(firstSelection)
	vote(secondSelection)

	currentBallots := func() []string {
		t.Helper()
		rows, err := pool.Query(context.Background(), "SELECT option_id::text FROM ballots WHERE poll_id=$1 AND user_id=$2 ORDER BY option_id", poll.ID, MiaID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		ids := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return ids
	}
	auditHistory := func() []BallotAudit {
		t.Helper()
		res := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+poll.ID+"/audit", "")
		if res.Code != http.StatusOK {
			t.Fatalf("admin ballot history returned %d", res.Code)
		}
		var history []BallotAudit
		if err := json.Unmarshal(res.Body.Bytes(), &history); err != nil {
			t.Fatal(err)
		}
		return history
	}
	wantCurrent := currentBallots()
	wantHistory := auditHistory()
	if len(wantCurrent) != 2 || len(wantHistory) != 4 {
		t.Fatalf("setup ballot state: current rows=%d history rows=%d", len(wantCurrent), len(wantHistory))
	}

	closed := status(opened.Version, "closed", ManagerID, http.StatusOK)
	hiddenFromClosed := status(closed.Version, "draft", ManagerID, http.StatusOK)
	if hiddenFromClosed.Status != "draft" || hiddenFromClosed.OpenedAt == nil || !hiddenFromClosed.OpenedAt.Equal(*opened.OpenedAt) {
		t.Fatal("hiding a closed poll changed its first-open timeline")
	}
	if _, ok := categoriesFor(t, app, MiaID)[poll.ID]; ok {
		t.Fatal("student can see a hidden poll")
	}
	hiddenMember := "00000000-0000-4000-8000-0000000000f9"
	if _, err := pool.Exec(context.Background(), "UPDATE users SET cohort_member=false WHERE id=$1", newMember); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,'hidden-poll-member','Hidden member','student',true,true)", hiddenMember); err != nil {
		t.Fatal(err)
	}
	studentVote := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+poll.ID+"/ballot", fmt.Sprintf(`{"option_id":%q}`, firstOptions[0].ID))
	if studentVote.Code != http.StatusNotFound {
		t.Fatalf("student vote for hidden poll returned %d", studentVote.Code)
	}
	managerVote := authenticatedRequest(t, app, pool, ManagerID, http.MethodPut, "/api/v1/categories/"+poll.ID+"/ballot", fmt.Sprintf(`{"option_id":%q}`, firstOptions[0].ID))
	if managerVote.Code != http.StatusConflict {
		t.Fatalf("editor vote for hidden poll returned %d", managerVote.Code)
	}
	editHidden := fmt.Sprintf(`{"name":"Edited while hidden","description":"","kind":"person","allow_self_vote":true,"all_people":true,"max_choices":2,"options":[],"version":%d}`, hiddenFromClosed.Version)
	if res := authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, "/api/v1/categories/"+poll.ID, editHidden); res.Code != http.StatusConflict {
		t.Fatalf("manager edited a previously opened hidden definition: %d", res.Code)
	}

	reopened := status(hiddenFromClosed.Version, "open", ManagerID, http.StatusOK)
	if reopened.OpenedAt == nil || !reopened.OpenedAt.Equal(*opened.OpenedAt) {
		t.Fatal("reopening changed opened_at")
	}
	if !reflect.DeepEqual(reopened.Options, firstOptions) {
		t.Fatal("reopening changed candidate option IDs or labels")
	}
	if !reflect.DeepEqual(currentBallots(), wantCurrent) || !reflect.DeepEqual(auditHistory(), wantHistory) {
		t.Fatal("reopening changed a current vote or named ballot history")
	}
	studentView, _ := listedCategory(t, app, pool, MiaID, poll.ID)
	if !reflect.DeepEqual(studentView.MyOptionIDs, wantCurrent) {
		t.Fatal("student's current vote was not preserved while hidden")
	}

	hiddenFromOpen := status(reopened.Version, "draft", ManagerID, http.StatusOK)
	reopenedAgain := status(hiddenFromOpen.Version, "open", ManagerID, http.StatusOK)
	if reopenedAgain.OpenedAt == nil || !reopenedAgain.OpenedAt.Equal(*opened.OpenedAt) || !reflect.DeepEqual(reopenedAgain.Options, firstOptions) {
		t.Fatal("open-hide-reopen changed the first-open timeline or candidate snapshot")
	}
	if !reflect.DeepEqual(currentBallots(), wantCurrent) || !reflect.DeepEqual(auditHistory(), wantHistory) {
		t.Fatal("open-hide-reopen changed current votes or named ballot history")
	}

	// A manager without a category grant cannot transition a poll created by an admin.
	unassigned := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Unassigned","description":"","kind":"proposal","options":[{"label":"A"},{"label":"B"}]}`), http.StatusCreated)
	denied := authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories/"+unassigned.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, unassigned.Version))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("unassigned manager status transition returned %d", denied.Code)
	}
}

func TestAdminCanDeletePollWithVotesAndHistory(t *testing.T) {
	app, pool := timelineApp(t)
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Delete test","description":"","kind":"proposal","options":[{"label":"Private choice one"},{"label":"Private choice two"}]}`), http.StatusCreated)
	poll = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+poll.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, poll.Version)), http.StatusOK)
	optionIDs := []string{poll.Options[0].ID, poll.Options[1].ID}
	for _, selection := range optionIDs {
		res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+poll.ID+"/ballot", fmt.Sprintf(`{"option_id":%q}`, selection))
		if res.Code != http.StatusOK {
			t.Fatalf("cast ballot for delete test returned %d", res.Code)
		}
	}
	if _, err := pool.Exec(context.Background(), "UPDATE users SET category_ids=array_append(category_ids,$1::uuid) WHERE id=ANY($2::uuid[])", poll.ID, []string{ManagerID, MiaID, LeonID}); err != nil {
		t.Fatal(err)
	}

	deletePath := "/api/v1/categories/" + poll.ID
	// Role checks happen before record mutation, including for managers with no grant.
	for _, actor := range []string{MiaID, ManagerID} {
		res := authenticatedRequest(t, app, pool, actor, http.MethodDelete, deletePath, fmt.Sprintf(`{"version":%d}`, poll.Version))
		if res.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s delete returned %d", actor, res.Code)
		}
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, deletePath, fmt.Sprintf(`{"version":%d}`, poll.Version-1)); res.Code != http.StatusConflict {
		t.Fatalf("stale delete returned %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, "/api/v1/categories/99999999-0000-4000-8000-000000000009", `{"version":1}`); res.Code != http.StatusNotFound {
		t.Fatalf("missing delete returned %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, "/api/v1/categories/not-an-id", `{"version":1}`); res.Code != http.StatusNotFound {
		t.Fatalf("malformed ID delete returned %d", res.Code)
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, "/api/v1/categories/"+categoryID(1), `{"version":1}`); res.Code != http.StatusBadRequest {
		t.Fatalf("repeatable category delete returned %d", res.Code)
	}
	var stillExists bool
	if err := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1)", poll.ID).Scan(&stillExists); err != nil || !stillExists {
		t.Fatalf("failed deletes removed the poll: exists=%v err=%v", stillExists, err)
	}

	res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, deletePath, fmt.Sprintf(`{"version":%d}`, poll.Version))
	if res.Code != http.StatusNoContent || res.Body.Len() != 0 {
		t.Fatalf("delete returned %d with body length %d", res.Code, res.Body.Len())
	}
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodDelete, deletePath, fmt.Sprintf(`{"version":%d}`, poll.Version)); res.Code != http.StatusNotFound {
		t.Fatalf("repeat delete returned %d", res.Code)
	}
	var categories, ballots, history, options, deleteEvents int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM categories WHERE id=$1", poll.ID).Scan(&categories); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM ballots WHERE poll_id=$1", poll.ID).Scan(&ballots); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM ballot_audit WHERE poll_id=$1", poll.ID).Scan(&history); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM poll_options WHERE poll_id=$1", poll.ID).Scan(&options); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE actor_id=$1 AND action='poll.deleted' AND entity_id=$2", AdminID, poll.ID).Scan(&deleteEvents); err != nil {
		t.Fatal(err)
	}
	if categories != 0 || ballots != 0 || history != 0 || options != 0 || deleteEvents != 1 {
		t.Fatalf("deletion rows: category=%d ballots=%d history=%d options=%d delete events=%d", categories, ballots, history, options, deleteEvents)
	}
	for _, user := range []string{ManagerID, MiaID, LeonID} {
		var hasGrant bool
		if err := pool.QueryRow(context.Background(), "SELECT $1::uuid=ANY(category_ids) FROM users WHERE id=$2", poll.ID, user).Scan(&hasGrant); err != nil || hasGrant {
			t.Fatalf("deleted category grant remains for %s: granted=%v err=%v", user, hasGrant, err)
		}
	}
	adminAudit := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/admin/audit", "")
	if adminAudit.Code != http.StatusOK || !json.Valid(adminAudit.Body.Bytes()) {
		t.Fatalf("admin audit returned %d", adminAudit.Code)
	}
	var events []struct {
		Action   string `json:"action"`
		EntityID string `json:"entity_id"`
	}
	if err := json.Unmarshal(adminAudit.Body.Bytes(), &events); err != nil {
		t.Fatal(err)
	}
	deletedAuditFound := false
	for _, candidate := range events {
		if candidate.EntityID == poll.ID && candidate.Action == "poll.deleted" {
			deletedAuditFound = true
		}
	}
	if !deletedAuditFound {
		t.Fatalf("deleted poll audit event missing or malformed")
	}
	for _, privateChoice := range []string{"Private choice one", "Private choice two", optionIDs[0], optionIDs[1]} {
		if strings.Contains(adminAudit.Body.String(), privateChoice) {
			t.Fatal("generic audit exposed a private poll choice")
		}
	}
}

func TestDeleteCategorySerializesGrantCleanup(t *testing.T) {
	app, pool := timelineApp(t)
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Grant race","description":"","kind":"proposal","options":[{"label":"A"},{"label":"B"}]}`), http.StatusCreated)

	// Hold the same lock used by admin grant edits. A deletion must wait so a
	// grant that commits first is included in its cleanup.
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(context.Background(), "SELECT pg_advisory_xact_lock(74120984)"); err != nil {
		t.Fatal(err)
	}
	token, csrf := randomToken(), randomToken()
	if _, err := pool.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", digest(token), AdminID, csrf); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/categories/"+poll.ID, strings.NewReader(fmt.Sprintf(`{"version":%d}`, poll.Version)))
	req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	req.Header.Set("X-CSRF-Token", csrf)
	result := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		app.ServeHTTP(result, req)
		close(done)
	}()
	select {
	case <-done:
		_ = tx.Rollback(context.Background())
		t.Fatalf("category deletion did not wait for the grant lock: status=%d", result.Code)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := tx.Exec(context.Background(), "UPDATE users SET category_ids=array_append(category_ids,$1::uuid) WHERE id=$2", poll.ID, ManagerID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("category deletion did not finish after the grant lock was released")
	}
	if result.Code != http.StatusNoContent {
		t.Fatalf("category deletion returned %d", result.Code)
	}
	var hasGrant, categoryExists bool
	if err := pool.QueryRow(context.Background(), "SELECT $1::uuid=ANY(category_ids) FROM users WHERE id=$2", poll.ID, ManagerID).Scan(&hasGrant); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1)", poll.ID).Scan(&categoryExists); err != nil {
		t.Fatal(err)
	}
	if hasGrant || categoryExists {
		t.Fatalf("grant cleanup raced deletion: grant remains=%v category exists=%v", hasGrant, categoryExists)
	}
}
