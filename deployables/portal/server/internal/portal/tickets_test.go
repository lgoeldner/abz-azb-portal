package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests need TEST_DATABASE_URL (disposable PostgreSQL); they skip without it.
//
// Status codes pinned here: students/guests and every non-editor get 403 before any validation; stale versions,
// votes outside review/done, a second claim and a repeated status are 409; invalid payloads, unknown references and
// ineligible assignees are 400; a self-vote by the assignee that does not meet rule 3 is 403.

type ticketFixture struct {
	t    *testing.T
	app  *App
	pool *pgxpool.Pool
	// r1 and r2 are default reviewers of area; m and m2 are plain managers; pending is a manager awaiting admission.
	r1, r2, m, m2, pending string
	area                   string
}

func newTicketFixture(t *testing.T) *ticketFixture {
	t.Helper()
	app, pool := timelineApp(t)
	f := &ticketFixture{t: t, app: app, pool: pool}
	f.r1, f.r2, f.m, f.m2 = f.user("manager", true), f.user("manager", true), f.user("manager", true), f.user("manager", true)
	f.pending = f.user("manager", false)
	f.area = f.newArea(f.r1, f.r2)
	return f
}

func (f *ticketFixture) user(role string, admitted bool) string {
	f.t.Helper()
	id := ID()
	if _, err := f.pool.Exec(context.Background(), "INSERT INTO users(id,subject,name,role,admitted,cohort_member) VALUES($1,$2,$3,$4,$5,true)", id, "ticket-test-"+id, "Test "+id[:8], role, admitted); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *ticketFixture) do(actor, method, path string, body any) *httptest.ResponseRecorder {
	f.t.Helper()
	raw := ""
	switch v := body.(type) {
	case nil:
	case string:
		raw = v
	default:
		b, err := json.Marshal(v)
		if err != nil {
			f.t.Fatal(err)
		}
		raw = string(b)
	}
	return authenticatedRequest(f.t, f.app, f.pool, actor, method, path, raw)
}

func decodeInto[T any](t *testing.T, res *httptest.ResponseRecorder, want int) T {
	t.Helper()
	if res.Code != want {
		t.Fatalf("status=%d want %d: %s", res.Code, want, res.Body)
	}
	var v T
	if err := json.Unmarshal(res.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", res.Body, err)
	}
	return v
}

func (f *ticketFixture) expect(res *httptest.ResponseRecorder, want int, what string) {
	f.t.Helper()
	if res.Code != want {
		f.t.Fatalf("%s: status=%d want %d: %s", what, res.Code, want, res.Body)
	}
}

func (f *ticketFixture) newArea(reviewers ...string) string {
	f.t.Helper()
	if reviewers == nil {
		reviewers = []string{}
	}
	res := f.do(AdminID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": "Bereich " + ID()[:8], "reviewer_ids": reviewers})
	return decodeInto[Area](f.t, res, 201).ID
}

// who builds an assignee_ids list; empty strings are dropped so who("") means nobody.
func who(ids ...string) []string {
	out := []string{}
	for _, id := range ids {
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

func (f *ticketFixture) body(area, assignee string, over map[string]any) map[string]any {
	b := map[string]any{"type": "aufgabe", "title": "Titel", "body": "", "area_id": area, "assignee_ids": who(assignee), "size": "M", "goal": "Ziel erreicht", "est_pages": nil}
	for k, v := range over {
		b[k] = v
	}
	return b
}

func (f *ticketFixture) create(actor string, body map[string]any) Ticket {
	f.t.Helper()
	return decodeInto[Ticket](f.t, f.do(actor, http.MethodPost, "/api/v1/tickets", body), 201)
}

func (f *ticketFixture) detail(id string) TicketDetail {
	f.t.Helper()
	return decodeInto[TicketDetail](f.t, f.do(AdminID, http.MethodGet, "/api/v1/tickets/"+id, nil), 200)
}

func (f *ticketFixture) get(id string) Ticket { f.t.Helper(); return f.detail(id).Ticket }

func (f *ticketFixture) setStatus(actor string, tk Ticket, status string) Ticket {
	f.t.Helper()
	res := f.do(actor, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/status", map[string]any{"version": tk.Version, "status": status})
	return decodeInto[Ticket](f.t, res, 200)
}

func editPayload(tk Ticket, over map[string]any) map[string]any {
	assignees := who()
	for _, a := range tk.Assignees {
		assignees = append(assignees, a.ID)
	}
	b := map[string]any{"title": tk.Title, "body": tk.Body, "area_id": tk.AreaID, "assignee_ids": assignees, "size": tk.Size, "goal": tk.Goal, "est_pages": tk.EstPages, "version": tk.Version}
	for k, v := range over {
		b[k] = v
	}
	return b
}

func (f *ticketFixture) edit(actor string, tk Ticket, over map[string]any) Ticket {
	f.t.Helper()
	return decodeInto[Ticket](f.t, f.editRaw(actor, tk, over), 200)
}

func (f *ticketFixture) editRaw(actor string, tk Ticket, over map[string]any) *httptest.ResponseRecorder {
	return f.do(actor, http.MethodPatch, "/api/v1/tickets/"+tk.ID, editPayload(tk, over))
}

// vote casts a vote against the ticket's current round (the way the UI does after loading it).
func (f *ticketFixture) vote(actor, id, verdict string, self bool) *httptest.ResponseRecorder {
	round := 1
	if res := f.do(AdminID, http.MethodGet, "/api/v1/tickets/"+id, nil); res.Code == http.StatusOK {
		round = decodeInto[TicketDetail](f.t, res, 200).Ticket.Round
	}
	return f.voteRound(actor, id, round, verdict, self)
}

func (f *ticketFixture) voteRound(actor, id string, round int, verdict string, self bool) *httptest.ResponseRecorder {
	return f.do(actor, http.MethodPut, "/api/v1/tickets/"+id+"/review", map[string]any{"verdict": verdict, "round": round, "self_confirmed": self})
}

func (f *ticketFixture) voted(actor, id, verdict string, self bool) Ticket {
	f.t.Helper()
	return decodeInto[Ticket](f.t, f.vote(actor, id, verdict, self), 200)
}

// inReview creates a ticket (admin as creator) with the given assignee and moves it to review.
func (f *ticketFixture) inReview(area, assignee string, over map[string]any) Ticket {
	f.t.Helper()
	tk := f.create(AdminID, f.body(area, assignee, over))
	return f.setStatus(AdminID, tk, "review")
}

func findReview(tk Ticket, user string) *TicketReview {
	for i := range tk.Reviews {
		if tk.Reviews[i].User.ID == user {
			return &tk.Reviews[i]
		}
	}
	return nil
}

func TestTicketBindingRules(t *testing.T) {
	f := newTicketFixture(t)

	// Rule 1: a default reviewer who is not the assignee votes bindingly.
	tk := f.inReview(f.area, f.m, nil)
	tk = f.voted(f.r1, tk.ID, "approve", false)
	if rv := findReview(tk, f.r1); rv == nil || !rv.Binding || !tk.Approved {
		t.Fatalf("rule 1: reviewer vote not binding/approved: %+v approved=%v", tk.Reviews, tk.Approved)
	}
	if done := f.setStatus(AdminID, tk, "done"); !done.Approved {
		t.Fatal("done ticket with a binding approval is not approved")
	}

	// Non-reviewer votes (a plain manager and an admin who is not listed as reviewer) are recorded but never binding.
	tk = f.inReview(f.area, f.m, nil)
	for _, voter := range []string{f.m2, AdminID} {
		tk = f.voted(voter, tk.ID, "approve", false)
		if rv := findReview(tk, voter); rv == nil || rv.Binding {
			t.Fatalf("non-reviewer %s vote must not be binding: %+v", voter, tk.Reviews)
		}
	}
	if tk.Approved {
		t.Fatal("ticket approved by non-binding votes only")
	}
	// The assignee who is no reviewer cannot vote at all.
	f.expect(f.vote(f.m, tk.ID, "approve", true), http.StatusForbidden, "non-reviewer assignee votes")
	f.expect(f.vote(f.m, tk.ID, "changes", false), http.StatusForbidden, "non-reviewer assignee changes vote")

	// A 'changes' vote by a reviewer is binding but never approves.
	tk = f.voted(f.r2, tk.ID, "changes", false)
	if tk.Approved {
		t.Fatal("changes vote approved the ticket")
	}

	// Rule 2: the assignee is a default reviewer, so any other manager or admin votes bindingly.
	for _, voter := range []string{f.m2, AdminID} {
		tk = f.inReview(f.area, f.r1, nil)
		tk = f.voted(voter, tk.ID, "approve", false)
		if rv := findReview(tk, voter); rv == nil || !rv.Binding || !tk.Approved {
			t.Fatalf("rule 2: voter %s binding=%+v approved=%v", voter, tk.Reviews, tk.Approved)
		}
	}

	// Rule 3: self approval needs reviewer = assignee, explicit confirmation, size XS/S and type aufgabe.
	tk = f.inReview(f.area, f.r1, map[string]any{"size": "XS"})
	f.expect(f.vote(f.r1, tk.ID, "approve", false), http.StatusForbidden, "self vote without confirmation")
	if got := f.get(tk.ID); len(got.Reviews) != 0 || got.Approved {
		t.Fatalf("rejected self vote left state behind: %+v", got.Reviews)
	}
	tk = f.voted(f.r1, tk.ID, "approve", true)
	if rv := findReview(tk, f.r1); rv == nil || !rv.Binding || !rv.SelfConfirmed || !tk.Approved {
		t.Fatalf("rule 3: %+v approved=%v", tk.Reviews, tk.Approved)
	}
	for name, over := range map[string]map[string]any{
		"size M":          {"size": "M"},
		"size XL":         {"size": "XL"},
		"artikel":         {"type": "artikel", "size": "XS", "est_pages": 1},
		"non-reviewer XS": {"size": "XS"},
	} {
		assignee := f.r1
		if name == "non-reviewer XS" {
			assignee = f.m
		}
		other := f.inReview(f.area, assignee, over)
		f.expect(f.vote(assignee, other.ID, "approve", true), http.StatusForbidden, "self vote "+name)
	}
	// Self confirmation is only honoured for the assignee: it is stored false for everyone else.
	tk = f.inReview(f.area, f.m, nil)
	tk = f.voted(f.r1, tk.ID, "approve", true)
	if rv := findReview(tk, f.r1); rv == nil || rv.SelfConfirmed {
		t.Fatalf("self_confirmed stored for a non-assignee: %+v", tk.Reviews)
	}

	// An admin listed as default reviewer is binding.
	adminArea := f.newArea(AdminID)
	tk = f.inReview(adminArea, f.m, nil)
	tk = f.voted(AdminID, tk.ID, "approve", false)
	if rv := findReview(tk, AdminID); rv == nil || !rv.Binding || !tk.Approved {
		t.Fatalf("admin reviewer vote: %+v approved=%v", tk.Reviews, tk.Approved)
	}

	// Votes are upserted per (ticket, user, round) and can flip.
	tk = f.inReview(f.area, f.m, nil)
	f.voted(f.r1, tk.ID, "approve", false)
	if got := f.voted(f.r1, tk.ID, "changes", false); got.Approved || len(got.Reviews) != 1 {
		t.Fatalf("flip to changes: approved=%v reviews=%+v", got.Approved, got.Reviews)
	}
	if got := f.voted(f.r1, tk.ID, "approve", false); !got.Approved || len(got.Reviews) != 1 {
		t.Fatalf("flip back to approve: approved=%v reviews=%+v", got.Approved, got.Reviews)
	}
	var rows int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM ticket_reviews WHERE ticket_id=$1 AND user_id=$2", tk.ID, f.r1).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("vote rows=%d err=%v", rows, err)
	}

	// Votes are only possible in review and done.
	open := f.create(AdminID, f.body(f.area, f.m, nil))
	f.expect(f.vote(f.r1, open.ID, "approve", false), http.StatusConflict, "vote in in_progress")
	todo := f.create(AdminID, f.body(f.area, "", nil))
	f.expect(f.vote(f.r1, todo.ID, "approve", false), http.StatusConflict, "vote in todo")
	f.expect(f.vote(f.r1, ticketID(1), "approve", false), http.StatusConflict, "vote on seeded todo ticket")
	f.expect(f.vote(f.r1, f.pending, "approve", false), http.StatusNotFound, "vote on unknown ticket")
	f.expect(f.do(f.r1, http.MethodPut, "/api/v1/tickets/"+tk.ID+"/review", map[string]any{"verdict": "maybe", "round": 1}), http.StatusBadRequest, "invalid verdict")
	done := f.setStatus(AdminID, tk, "done")
	f.voted(f.r2, done.ID, "approve", false)
}

// Invariant: changing who works on a ticket never makes a vote binding that would not bind otherwise.
func TestTicketCoAssigneesCannotSwitchBinding(t *testing.T) {
	f := newTicketFixture(t)
	small := map[string]any{"size": "XS"}

	// Rule 2 needs every assignee to be a reviewer: co-assigning a reviewer to a plain manager keeps others advisory.
	tk := f.inReview(f.area, "", map[string]any{"assignee_ids": who(f.m, f.r1)})
	tk = f.voted(f.m2, tk.ID, "approve", false)
	if rv := findReview(tk, f.m2); rv == nil || rv.Binding || tk.Approved {
		t.Fatalf("mixed assignees made a plain vote binding: %+v approved=%v", tk.Reviews, tk.Approved)
	}
	// The remaining reviewer who is not assigned still binds (rule 1).
	if tk = f.voted(f.r2, tk.ID, "approve", false); !tk.Approved {
		t.Fatalf("free reviewer did not bind: %+v", tk.Reviews)
	}
	// All assignees reviewers: nobody independent is left in the Bereich, so others bind (rule 2).
	tk = f.inReview(f.area, "", map[string]any{"assignee_ids": who(f.r1, f.r2)})
	if tk = f.voted(f.m, tk.ID, "approve", false); !tk.Approved {
		t.Fatalf("rule 2 with two reviewer assignees: %+v", tk.Reviews)
	}

	// Rule 3 only for a sole assignee: a reviewer sharing the work cannot approve it alone.
	tk = f.inReview(f.area, "", map[string]any{"assignee_ids": who(f.r1, f.m), "size": "XS"})
	f.expect(f.vote(f.r1, tk.ID, "approve", true), http.StatusForbidden, "self approval with a co-assignee")
	tk = f.inReview(f.area, "", map[string]any{"assignee_ids": who(f.r1, f.r2), "size": "XS"})
	f.expect(f.vote(f.r1, tk.ID, "approve", true), http.StatusForbidden, "self approval by one of two reviewer assignees")
	tk = f.inReview(f.area, f.r1, small)
	if tk = f.voted(f.r1, tk.ID, "approve", true); !tk.Approved {
		t.Fatalf("sole reviewer self approval: %+v", tk.Reviews)
	}

	// Leaving an open ticket to a reviewer does not make the leaver's vote binding (rule 2 skips former assignees),
	// while a colleague who never worked on it still binds.
	tk = f.create(f.m, f.body(f.area, "", map[string]any{"assignee_ids": who(f.m, f.r1)}))
	tk = f.edit(f.m, tk, map[string]any{"assignee_ids": who(f.r1)})
	tk = f.setStatus(f.r1, tk, "review")
	tk = f.voted(f.m, tk.ID, "approve", false)
	if rv := findReview(tk, f.m); rv == nil || rv.Binding || tk.Approved {
		t.Fatalf("former assignee bound under rule 2: %+v approved=%v", tk.Reviews, tk.Approved)
	}
	if tk = f.voted(f.m2, tk.ID, "approve", false); !tk.Approved {
		t.Fatalf("uninvolved colleague did not bind under rule 2: %+v", tk.Reviews)
	}

	// A plain assignee cannot hand an in-review ticket to a reviewer to make their own vote binding (rule 2).
	tk = f.inReview(f.area, f.m, nil)
	f.expect(f.editRaw(f.m, tk, map[string]any{"assignee_ids": who(f.r1)}), http.StatusForbidden, "hand-over in review")
	if got := f.get(tk.ID); len(got.Assignees) != 1 || got.Assignees[0].ID != f.m {
		t.Fatalf("rejected hand-over changed the ticket: %+v", got)
	}
	f.expect(f.vote(f.m, tk.ID, "approve", false), http.StatusForbidden, "plain assignee votes")
}

func TestTicketPeopleListsOnlyEditors(t *testing.T) {
	f := newTicketFixture(t)
	people := decodeInto[[]UserRef](t, f.do(f.m, http.MethodGet, "/api/v1/tickets/people", nil), 200)
	ids := map[string]bool{}
	for _, p := range people {
		ids[p.ID] = true
	}
	for _, id := range []string{f.r1, f.m, AdminID, ManagerID} {
		if !ids[id] {
			t.Errorf("editor %s missing from people", id)
		}
	}
	for _, id := range []string{MiaID, f.pending} {
		if ids[id] {
			t.Errorf("non-editor %s listed in people", id)
		}
	}
	f.expect(f.do(MiaID, http.MethodGet, "/api/v1/tickets/people", nil), http.StatusForbidden, "student lists people")
}

func TestTicketRoundsInvalidateEarlierVotes(t *testing.T) {
	f := newTicketFixture(t)
	otherArea := f.newArea(f.r1)
	approvedArticle := func() Ticket {
		tk := f.inReview(f.area, f.m, map[string]any{"type": "artikel", "est_pages": 2})
		tk = f.voted(f.r1, tk.ID, "approve", false)
		if !tk.Approved || tk.Round != 1 {
			t.Fatalf("setup: approved=%v round=%d", tk.Approved, tk.Round)
		}
		return tk
	}
	for name, change := range map[string]func(Ticket) Ticket{
		"status back to in_progress": func(tk Ticket) Ticket { return f.setStatus(AdminID, tk, "in_progress") },
		"status back to todo":        func(tk Ticket) Ticket { return f.setStatus(AdminID, tk, "todo") },
		"area change":                func(tk Ticket) Ticket { return f.edit(AdminID, tk, map[string]any{"area_id": otherArea}) },
		"assignee change":            func(tk Ticket) Ticket { return f.edit(AdminID, tk, map[string]any{"assignee_ids": who(f.m2)}) },
		"size change":                func(tk Ticket) Ticket { return f.edit(AdminID, tk, map[string]any{"size": "L"}) },
		"est_pages change":           func(tk Ticket) Ticket { return f.edit(AdminID, tk, map[string]any{"est_pages": 3}) },
	} {
		before := approvedArticle()
		after := change(before)
		if after.Round != before.Round+1 || after.Approved || len(after.Reviews) != 0 {
			t.Errorf("%s: round %d->%d approved=%v reviews=%d", name, before.Round, after.Round, after.Approved, len(after.Reviews))
		}
		var history int
		if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM ticket_reviews WHERE ticket_id=$1 AND round=$2", before.ID, before.Round).Scan(&history); err != nil || history != 1 {
			t.Errorf("%s: earlier votes must stay as history, rows=%d err=%v", name, history, err)
		}
	}

	// Changes that keep the round: title/goal/body edits, review -> done, done -> review.
	tk := approvedArticle()
	tk = f.edit(AdminID, tk, map[string]any{"title": "Neuer Titel", "goal": "Anderes Ziel", "body": "Text"})
	if tk.Round != 1 || !tk.Approved {
		t.Fatalf("text edit changed round/approval: round=%d approved=%v", tk.Round, tk.Approved)
	}
	tk = f.setStatus(AdminID, tk, "done")
	if tk.Round != 1 || !tk.Approved {
		t.Fatalf("review->done changed round/approval: round=%d approved=%v", tk.Round, tk.Approved)
	}
	tk = f.setStatus(AdminID, tk, "review")
	if tk.Round != 1 || !tk.Approved {
		t.Fatalf("done->review changed round/approval: round=%d approved=%v", tk.Round, tk.Approved)
	}

	// After a bump the same voter can approve again in the new round; both rounds stay stored.
	tk = f.setStatus(AdminID, tk, "in_progress")
	tk = f.setStatus(AdminID, tk, "review")
	if tk.Round != 2 || tk.Approved {
		t.Fatalf("round=%d approved=%v after sending back", tk.Round, tk.Approved)
	}
	tk = f.voted(f.r1, tk.ID, "approve", false)
	if !tk.Approved {
		t.Fatal("approval in the new round did not count")
	}
	var total int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM ticket_reviews WHERE ticket_id=$1 AND user_id=$2", tk.ID, f.r1).Scan(&total); err != nil || total != 2 {
		t.Fatalf("expected one vote row per round, got %d (err %v)", total, err)
	}

	// Reassigning an approved ticket to its approver starts a new round, and the approver then cannot approve it
	// alone (size M, rule 3 not met); another manager's vote is binding through rule 2.
	tk = f.inReview(f.area, f.m, nil)
	tk = f.voted(f.r1, tk.ID, "approve", false)
	tk = f.edit(AdminID, tk, map[string]any{"assignee_ids": who(f.r1)})
	if tk.Approved || tk.Round != 2 {
		t.Fatalf("reassign to approver: approved=%v round=%d", tk.Approved, tk.Round)
	}
	f.expect(f.vote(f.r1, tk.ID, "approve", true), http.StatusForbidden, "approver approving own ticket")
	if tk = f.voted(f.m2, tk.ID, "approve", false); !tk.Approved {
		t.Fatal("another manager's vote on a reviewer-assigned ticket should be binding")
	}
}

func TestTicketApprovalRechecksVoterAtReadTime(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.inReview(f.area, f.m, nil)
	f.voted(f.r1, tk.ID, "approve", false)
	set := func(sql string, args ...any) {
		t.Helper()
		if _, err := f.pool.Exec(context.Background(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	approved := func() bool { t.Helper(); return f.get(tk.ID).Approved }
	if !approved() {
		t.Fatal("setup: ticket should be approved")
	}
	set("UPDATE users SET role='student' WHERE id=$1", f.r1)
	if approved() {
		t.Fatal("demoted reviewer's vote still counts")
	}
	set("UPDATE users SET role='manager' WHERE id=$1", f.r1)
	set("UPDATE users SET admitted=false WHERE id=$1", f.r1)
	if approved() {
		t.Fatal("vote of a no longer admitted reviewer still counts")
	}
	set("UPDATE users SET admitted=true WHERE id=$1", f.r1)
	if !approved() {
		t.Fatal("restored reviewer's binding vote should count again")
	}
	// Binding is fixed at vote time: removing the grant later does not revoke the approval.
	var version int
	if err := f.pool.QueryRow(context.Background(), "SELECT version FROM areas WHERE id=$1", f.area).Scan(&version); err != nil {
		t.Fatal(err)
	}
	f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+f.area, map[string]any{"name": "Umbenannt " + f.area[:8], "reviewer_ids": []string{f.r2}, "version": version}), 200, "drop reviewer grant")
	if !approved() {
		t.Fatal("removing the reviewer grant revoked an already binding vote")
	}
}

func TestTicketPermissions(t *testing.T) {
	f := newTicketFixture(t)

	// Create: every editor may assign any admitted editors, several at once, or nobody.
	if got := f.create(f.m, f.body(f.area, "", map[string]any{"assignee_ids": who(f.r1, f.m2, f.r1)})); len(got.Assignees) != 2 || got.Status != "in_progress" {
		t.Fatalf("plain manager assigns two people (with a duplicate): %+v", got)
	}
	if got := f.create(f.m, f.body(f.area, "", nil)); got.Status != "todo" || len(got.Assignees) > 0 {
		t.Fatalf("plain manager creates unassigned: %+v", got)
	}
	own := f.create(f.m, f.body(f.area, f.m, nil))
	if own.Status != "in_progress" || len(own.Assignees) == 0 || own.Assignees[0].ID != f.m || own.CreatedBy.ID != f.m || own.Round != 1 || own.Version != 1 {
		t.Fatalf("self-assigned ticket: %+v", own)
	}
	if got := f.create(f.r1, f.body(f.area, "", nil)); got.Status != "todo" || len(got.Assignees) > 0 {
		t.Fatalf("reviewer creating unassigned: %+v", got)
	}
	if got := f.create(AdminID, f.body(f.area, "", nil)); got.Status != "todo" || len(got.Assignees) > 0 {
		t.Fatalf("admin creating unassigned: %+v", got)
	}
	if got := f.create(f.r1, f.body(f.area, f.m2, nil)); len(got.Assignees) == 0 || got.Assignees[0].ID != f.m2 || got.Status != "in_progress" {
		t.Fatalf("reviewer assigning another manager: %+v", got)
	}
	if got := f.create(AdminID, f.body(f.area, f.m2, nil)); got.Status != "in_progress" {
		t.Fatalf("admin assigning: %+v", got)
	}
	// Assignees must be admitted managers or admins.
	student := MiaID
	for name, id := range map[string]string{"student": student, "pending manager": f.pending, "unknown user": "00000000-0000-4000-8000-0000000000ee", "not a uuid": "x"} {
		f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", f.body(f.area, id, nil)), http.StatusBadRequest, "assignee "+name)
	}
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", f.body("00000000-0000-4000-8000-0000000000ee", "", nil)), http.StatusBadRequest, "unknown area")

	// Plain managers who are not the assignee can neither edit, move, assign nor review-assign.
	other := f.create(AdminID, f.body(f.area, f.m2, nil))
	f.expect(f.editRaw(f.m, other, map[string]any{"title": "Fremd"}), http.StatusForbidden, "non-reviewer edit")
	f.expect(f.editRaw(f.m, other, map[string]any{"assignee_ids": who(f.m)}), http.StatusForbidden, "non-reviewer takes over via edit")
	f.expect(f.do(f.m, http.MethodPost, "/api/v1/tickets/"+other.ID+"/status", map[string]any{"version": other.Version, "status": "review"}), http.StatusForbidden, "non-reviewer status")
	// Area reviewers and admins may edit and move any ticket of the area.
	if got := f.edit(f.r1, other, map[string]any{"title": "Von Reviewer"}); got.Title != "Von Reviewer" {
		t.Fatalf("reviewer edit: %+v", got)
	}
	other = f.get(other.ID)
	if got := f.setStatus(f.r2, other, "review"); got.Status != "review" {
		t.Fatalf("reviewer status: %+v", got)
	}
	// A reviewer of another area is a plain manager here.
	otherArea := f.newArea(f.m)
	foreign := f.create(AdminID, f.body(otherArea, f.m2, nil))
	f.expect(f.editRaw(f.r1, foreign, map[string]any{"title": "Fremder Bereich"}), http.StatusForbidden, "reviewer of another area")

	// An assignee may change only who works on the ticket (and only while it is open).
	assigned := f.create(f.m, f.body(f.area, f.m, nil))
	f.expect(f.editRaw(f.m, assigned, map[string]any{"title": "Anders"}), http.StatusForbidden, "assignee edits title")
	f.expect(f.editRaw(f.m, assigned, map[string]any{"assignee_ids": who(), "size": "L"}), http.StatusForbidden, "assignee releases and edits")
	f.expect(f.editRaw(f.m, assigned, map[string]any{"area_id": otherArea}), http.StatusForbidden, "assignee moves area")
	if got := f.get(assigned.ID); got.Version != assigned.Version || got.Title != assigned.Title {
		t.Fatalf("rejected edits changed the ticket: %+v", got)
	}
	if got := f.setStatus(f.m, assigned, "review"); got.Status != "review" {
		t.Fatalf("assignee moves own ticket: %+v", got)
	}
	inReview := f.get(assigned.ID)
	f.expect(f.editRaw(f.m, inReview, map[string]any{"assignee_ids": who(f.m, f.m2)}), http.StatusForbidden, "assignee adds a colleague in review")
	f.expect(f.editRaw(f.m, inReview, map[string]any{"assignee_ids": who()}), http.StatusForbidden, "assignee leaves in review")
	assigned = f.setStatus(f.m, inReview, "in_progress")
	shared := f.edit(f.m, assigned, map[string]any{"assignee_ids": who(f.m, f.m2)})
	if len(shared.Assignees) != 2 || shared.Round != assigned.Round+1 {
		t.Fatalf("assignee adds a colleague: %+v", shared)
	}
	// The added colleague is an assignee too and may move the ticket.
	if got := f.setStatus(f.m2, shared, "review"); got.Status != "review" {
		t.Fatalf("co-assignee moves the ticket: %+v", got)
	}
	assigned = f.setStatus(f.m2, f.get(shared.ID), "in_progress")
	released := f.edit(f.m, assigned, map[string]any{"assignee_ids": who()})
	if len(released.Assignees) > 0 || released.Status != "todo" || released.Version != assigned.Version+1 || released.Round != assigned.Round+1 {
		t.Fatalf("release: %+v", released)
	}
	f.expect(f.editRaw(f.m, released, map[string]any{"title": "Nach Abgabe"}), http.StatusForbidden, "former assignee edits")
	// Released tickets can be claimed again.
	if claimed := decodeInto[Ticket](t, f.do(f.m2, http.MethodPost, "/api/v1/tickets/"+released.ID+"/claim", nil), 200); len(claimed.Assignees) == 0 || claimed.Assignees[0].ID != f.m2 {
		t.Fatalf("claim after release: %+v", claimed)
	}

	// Roles are re-checked on every request: a demoted manager is locked out immediately.
	if _, err := f.pool.Exec(context.Background(), "UPDATE users SET role='student' WHERE id=$1", f.m2); err != nil {
		t.Fatal(err)
	}
	f.expect(f.do(f.m2, http.MethodPost, "/api/v1/tickets", f.body(f.area, "", nil)), http.StatusForbidden, "demoted manager creates")
	f.expect(f.do(f.m2, http.MethodGet, "/api/v1/tickets", nil), http.StatusForbidden, "demoted manager lists")
	if _, err := f.pool.Exec(context.Background(), "UPDATE users SET role='manager' WHERE id=$1", f.m2); err != nil {
		t.Fatal(err)
	}

	// A demoted reviewer cannot be assigned any more.
	if _, err := f.pool.Exec(context.Background(), "UPDATE users SET role='student' WHERE id=$1", f.r2); err != nil {
		t.Fatal(err)
	}
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", f.body(f.area, f.r2, nil)), http.StatusBadRequest, "assign demoted reviewer")
}

func TestStudentsAndPendingAccountsAreDeniedEverywhere(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.create(AdminID, f.body(f.area, "", nil))
	before := len(decodeInto[[]Ticket](t, f.do(AdminID, http.MethodGet, "/api/v1/tickets?include_finished=true", nil), 200))
	calls := []struct{ method, path, body string }{
		{"GET", "/api/v1/areas", ""},
		{"POST", "/api/v1/admin/areas", `{"name":"X","reviewer_ids":[]}`},
		{"PATCH", "/api/v1/admin/areas/" + f.area, `{"name":"X","reviewer_ids":[],"version":1}`},
		{"GET", "/api/v1/tickets", ""},
		{"POST", "/api/v1/tickets", mustJSON(t, f.body(f.area, "", nil))},
		{"GET", "/api/v1/tickets/" + tk.ID, ""},
		{"PATCH", "/api/v1/tickets/" + tk.ID, mustJSON(t, editPayload(tk, nil))},
		{"POST", "/api/v1/tickets/" + tk.ID + "/status", `{"version":1,"status":"in_progress"}`},
		{"POST", "/api/v1/tickets/" + tk.ID + "/claim", ""},
		{"POST", "/api/v1/tickets/" + tk.ID + "/comments", `{"body":"hallo"}`},
		{"PUT", "/api/v1/tickets/" + tk.ID + "/review", `{"verdict":"approve","round":1}`},
	}
	for _, who := range []string{MiaID, LeonID, GuestID, PendingID} {
		for _, c := range calls {
			if res := f.do(who, c.method, c.path, c.body); res.Code != http.StatusForbidden {
				t.Errorf("%s %s as %s: status=%d, want 403", c.method, c.path, who, res.Code)
			}
		}
	}
	// Managers (not admins) may not administer areas.
	for _, c := range calls[1:3] {
		if res := f.do(ManagerID, c.method, c.path, c.body); res.Code != http.StatusForbidden {
			t.Errorf("%s %s as manager: status=%d, want 403", c.method, c.path, res.Code)
		}
	}
	after := f.get(tk.ID)
	if after.Version != tk.Version || len(after.Assignees) > 0 || after.Status != "todo" {
		t.Fatalf("denied requests changed the ticket: %+v", after)
	}
	if n := len(decodeInto[[]Ticket](t, f.do(AdminID, http.MethodGet, "/api/v1/tickets?include_finished=true", nil), 200)); n != before {
		t.Fatalf("denied requests changed the ticket count: %d -> %d", before, n)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTicketClaimIsAtomic(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.create(AdminID, f.body(f.area, "", nil))
	contenders := []string{AdminID, ManagerID, f.r1, f.r2, f.m, f.m2}
	type session struct{ user, token, csrf string }
	sessions := []session{}
	for _, u := range contenders {
		token, csrf := sessionFor(t, f.app, u)
		sessions = append(sessions, session{u, token, csrf})
	}
	type result struct {
		user string
		code int
	}
	results := make(chan result, 2*len(sessions))
	start := make(chan struct{})
	var wg sync.WaitGroup
	// Every contender claims twice at once: claim joins the assignees, so each user gets in exactly once.
	for _, s := range append(slices.Clone(sessions), sessions...) {
		wg.Add(1)
		go func(s session) {
			defer wg.Done()
			<-start
			res := send(f.app, contractOperation{http.MethodPost, "/api/v1/tickets/" + tk.ID + "/claim"}, s.token, s.csrf, "")
			results <- result{s.user, res.Code}
		}(s)
	}
	close(start)
	wg.Wait()
	close(results)
	joined := map[string]int{}
	for r := range results {
		switch r.code {
		case http.StatusOK:
			joined[r.user]++
		case http.StatusConflict:
		default:
			t.Errorf("claim by %s: unexpected status %d", r.user, r.code)
		}
	}
	for _, u := range contenders {
		if joined[u] != 1 {
			t.Fatalf("user %s joined %d times", u, joined[u])
		}
	}
	got := f.get(tk.ID)
	if len(got.Assignees) != len(contenders) || got.Status != "in_progress" || got.Version != tk.Version+len(contenders) {
		t.Fatalf("claimed ticket: %+v", got)
	}
	assignEvents := 0
	for _, ev := range f.detail(tk.ID).Events {
		if ev.Kind == "assign" {
			assignEvents++
		}
	}
	if assignEvents != len(contenders) {
		t.Fatalf("expected %d assign events, got %d", len(contenders), assignEvents)
	}
	f.expect(f.do(MiaID, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/claim", nil), http.StatusForbidden, "student claim")
	f.expect(f.do(f.m, http.MethodPost, "/api/v1/tickets/00000000-0000-4000-8000-0000000000ee/claim", nil), http.StatusNotFound, "claim of unknown ticket")
}

func TestTicketStaleVersionsAreConflicts(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.create(AdminID, f.body(f.area, f.m, nil))
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/status", map[string]any{"version": tk.Version + 5, "status": "review"}), http.StatusConflict, "status with wrong version")
	moved := f.setStatus(AdminID, tk, "review")
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/status", map[string]any{"version": tk.Version, "status": "done"}), http.StatusConflict, "status with stale version")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"title": "Veraltet"}), http.StatusConflict, "edit with stale version")
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/status", map[string]any{"version": moved.Version, "status": "review"}), http.StatusConflict, "status to the same status")
	if got := f.get(tk.ID); got.Title != tk.Title || got.Status != "review" || got.Version != moved.Version {
		t.Fatalf("rejected requests changed the ticket: %+v", got)
	}
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/status", map[string]any{"version": moved.Version, "status": "bogus"}), http.StatusBadRequest, "unknown status")
	// Two editors submit the same version at the same time: exactly one wins, the other gets 409.
	type session struct{ user, token, csrf string }
	var sessions []session
	for _, u := range []string{AdminID, f.r1, f.r2} {
		token, csrf := sessionFor(t, f.app, u)
		sessions = append(sessions, session{u, token, csrf})
	}
	codes := make(chan int, len(sessions))
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i, s := range sessions {
		wg.Add(1)
		go func(i int, s session) {
			defer wg.Done()
			body := mustJSON(t, editPayload(moved, map[string]any{"title": "Titel " + s.user[:8]}))
			<-start
			codes <- sendBody(f.app, contractOperation{http.MethodPatch, "/api/v1/tickets/" + tk.ID}, s.token, s.csrf, "", body).Code
		}(i, s)
	}
	close(start)
	wg.Wait()
	close(codes)
	ok, conflicts := 0, 0
	for c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflicts++
		default:
			t.Errorf("concurrent edit: unexpected status %d", c)
		}
	}
	if ok != 1 || conflicts != len(sessions)-1 {
		t.Fatalf("concurrent edits: %d succeeded, %d conflicted", ok, conflicts)
	}
	if got := f.get(tk.ID); got.Version != moved.Version+1 {
		t.Fatalf("concurrent edits bumped the version to %d, want %d", got.Version, moved.Version+1)
	}
	f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+f.area, map[string]any{"name": "Neu", "reviewer_ids": []string{}, "version": 99}), http.StatusConflict, "area with stale version")
}

func TestTicketValidation(t *testing.T) {
	f := newTicketFixture(t)
	long := func(n int) string { return strings.Repeat("a", n) }
	for name, over := range map[string]map[string]any{
		"size missing":          {"size": ""},
		"size unknown":          {"size": "XXL"},
		"goal missing":          {"goal": ""},
		"goal blank":            {"goal": "   "},
		"goal too long":         {"goal": long(1001)},
		"title missing":         {"title": ""},
		"title too long":        {"title": long(201)},
		"body too long":         {"body": long(50001)},
		"type unknown":          {"type": "epos"},
		"artikel without pages": {"type": "artikel"},
		"artikel zero pages":    {"type": "artikel", "est_pages": 0},
		"artikel negative":      {"type": "artikel", "est_pages": -2},
		"aufgabe with pages":    {"est_pages": 3},
		"area missing":          {"area_id": ""},
	} {
		f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", f.body(f.area, "", over)), http.StatusBadRequest, "create "+name)
	}
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", mustJSON(t, map[string]any{"type": "aufgabe", "title": "x"})), http.StatusBadRequest, "create with missing fields")
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/tickets", mustJSON(t, f.body(f.area, "", map[string]any{"status": "done"}))), http.StatusBadRequest, "create with unknown field")
	// Boundary values are accepted.
	f.create(AdminID, f.body(f.area, "", map[string]any{"title": long(200), "goal": long(1000), "body": long(50000), "size": "XL"}))
	art := f.create(AdminID, f.body(f.area, "", map[string]any{"type": "artikel", "est_pages": 1}))
	if art.EstPages == nil || *art.EstPages != 1 || art.Type != "artikel" {
		t.Fatalf("artikel: %+v", art)
	}
	tk := f.create(AdminID, f.body(f.area, "", map[string]any{"title": "  Getrimmt  ", "goal": "  Ziel  "}))
	if tk.Title != "Getrimmt" || tk.Goal != "Ziel" {
		t.Fatalf("title/goal not trimmed: %q %q", tk.Title, tk.Goal)
	}

	// The same rules apply to edits; type is immutable.
	f.expect(f.editRaw(AdminID, tk, map[string]any{"size": ""}), http.StatusBadRequest, "edit size missing")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"goal": " "}), http.StatusBadRequest, "edit goal blank")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"est_pages": 2}), http.StatusBadRequest, "edit aufgabe with pages")
	f.expect(f.editRaw(AdminID, art, map[string]any{"est_pages": nil}), http.StatusBadRequest, "edit artikel without pages")
	f.expect(f.editRaw(AdminID, art, map[string]any{"est_pages": 0}), http.StatusBadRequest, "edit artikel zero pages")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"area_id": "00000000-0000-4000-8000-0000000000ee"}), http.StatusBadRequest, "edit unknown area")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"assignee_ids": who(MiaID)}), http.StatusBadRequest, "edit assignee student")
	f.expect(f.editRaw(AdminID, tk, map[string]any{"type": "artikel"}), http.StatusBadRequest, "edit type")
	if got := f.get(tk.ID); got.Version != tk.Version {
		t.Fatalf("invalid edits bumped the version: %d", got.Version)
	}

	// The database enforces the est_pages rule independently of the handlers.
	insert := func(typ string, pages any) error {
		_, err := f.pool.Exec(context.Background(), "INSERT INTO tickets(type,title,area_id,created_by,size,goal,est_pages) VALUES($1,'x',$2,$3,'S','g',$4)", typ, f.area, AdminID, pages)
		return err
	}
	if err := insert("artikel", 1); err != nil {
		t.Fatalf("positive control rejected: %v", err)
	}
	if err := insert("aufgabe", nil); err != nil {
		t.Fatalf("positive control rejected: %v", err)
	}
	for name, args := range map[string][2]any{"artikel null": {"artikel", nil}, "artikel zero": {"artikel", 0}, "aufgabe with pages": {"aufgabe", 2}} {
		if err := insert(args[0].(string), args[1]); err == nil {
			t.Errorf("database accepted %s", name)
		}
	}
}

func TestTicketTimelineAndComments(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.create(AdminID, f.body(f.area, f.m, nil))
	tk = f.setStatus(AdminID, tk, "review")
	tk = f.edit(AdminID, tk, map[string]any{"title": "Anders", "size": "L"})
	f.voted(f.r1, tk.ID, "approve", false)
	comment := decodeInto[TicketEvent](t, f.do(f.m, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/comments", map[string]any{"body": "  Bitte **prüfen**  "}), 201)
	if comment.Kind != "comment" || comment.Body != "Bitte **prüfen**" || comment.Actor.ID != f.m || comment.ID == "" {
		t.Fatalf("comment: %+v", comment)
	}
	for _, body := range []string{"", "   ", strings.Repeat("x", 10001)} {
		f.expect(f.do(f.m, http.MethodPost, "/api/v1/tickets/"+tk.ID+"/comments", map[string]any{"body": body}), http.StatusBadRequest, "invalid comment")
	}
	f.expect(f.do(f.m, http.MethodPost, "/api/v1/tickets/00000000-0000-4000-8000-0000000000ee/comments", map[string]any{"body": "x"}), http.StatusNotFound, "comment on unknown ticket")
	d := f.detail(tk.ID)
	if d.Ticket.Version != tk.Version {
		t.Fatalf("comments and votes must not change the ticket version: %d vs %d", d.Ticket.Version, tk.Version)
	}
	times := make([]time.Time, len(d.Events))
	for i, ev := range d.Events {
		times[i] = ev.CreatedAt
	}
	if !sort.SliceIsSorted(times, func(i, j int) bool { return times[i].Before(times[j]) }) {
		t.Fatalf("events are not ascending: %+v", d.Events)
	}
	kinds := []string{}
	details := map[string]string{}
	for _, ev := range d.Events {
		kinds = append(kinds, ev.Kind)
		details[ev.Kind] = ev.Detail
		if ev.Actor.Name == "" {
			t.Errorf("event without actor name: %+v", ev)
		}
	}
	for _, want := range []string{"assign", "status", "edit", "review", "comment"} {
		found := false
		for _, k := range kinds {
			found = found || k == want
		}
		if !found {
			t.Errorf("missing %s event in %v", want, kinds)
		}
	}
	var statusDetails []string
	for _, ev := range d.Events {
		if ev.Kind == "status" {
			statusDetails = append(statusDetails, ev.Detail)
		}
	}
	if len(statusDetails) != 1 || statusDetails[0] != "in_progress->review" {
		t.Errorf("status event details: %v", statusDetails)
	}
	if !strings.Contains(details["edit"], "title") || !strings.Contains(details["edit"], "size") {
		t.Errorf("edit event detail %q lacks changed fields", details["edit"])
	}
	// Audit actions are written for the mutations.
	for _, action := range []string{"ticket.created", "ticket.status", "ticket.updated", "ticket.reviewed", "ticket.commented"} {
		var n int
		if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action=$1 AND entity_id=$2", action, tk.ID).Scan(&n); err != nil || n == 0 {
			t.Errorf("audit action %s missing (n=%d err=%v)", action, n, err)
		}
	}
}

func TestSeededTicketsAndListFilters(t *testing.T) {
	f := newTicketFixture(t)
	list := func(actor, query string) []Ticket {
		t.Helper()
		return decodeInto[[]Ticket](t, f.do(actor, http.MethodGet, "/api/v1/tickets"+query, nil), 200)
	}
	ids := func(ts []Ticket) map[string]bool {
		m := map[string]bool{}
		for _, tk := range ts {
			m[tk.ID] = true
		}
		return m
	}
	all := list(ManagerID, "?include_finished=true")
	statuses, types := map[string]bool{}, map[string]bool{}
	for _, tk := range all {
		statuses[tk.Status], types[tk.Type] = true, true
	}
	if len(statuses) != 4 || len(types) != 2 {
		t.Fatalf("seed fixtures must cover four columns and both types: %v %v", statuses, types)
	}
	byID := map[string]Ticket{}
	for _, tk := range all {
		byID[tk.ID] = tk
	}
	if !byID[ticketID(5)].Approved || byID[ticketID(5)].Status != "done" || len(byID[ticketID(5)].Reviews) != 1 || !byID[ticketID(5)].Reviews[0].Binding {
		t.Fatalf("seed: approved done ticket: %+v", byID[ticketID(5)])
	}
	if byID[ticketID(6)].Approved || byID[ticketID(6)].Status != "done" {
		t.Fatalf("seed: done ticket must still wait for approval: %+v", byID[ticketID(6)])
	}

	// Finished (done and approved) tickets are hidden by default; done tickets waiting for approval stay visible.
	def := ids(list(ManagerID, ""))
	if def[ticketID(5)] || !def[ticketID(6)] || len(def) != len(all)-1 {
		t.Fatalf("default list: %v", def)
	}
	if ids(list(ManagerID, "?include_finished=false"))[ticketID(5)] {
		t.Fatal("include_finished=false showed a finished ticket")
	}
	// Newest activity first.
	ordered := list(AdminID, "?include_finished=true")
	if !sort.SliceIsSorted(ordered, func(i, j int) bool { return ordered[i].UpdatedAt.After(ordered[j].UpdatedAt) }) {
		t.Fatal("tickets are not ordered by updated_at descending")
	}
	// Reviews belong to the current round only.
	if _, err := f.pool.Exec(context.Background(), "UPDATE tickets SET round=2 WHERE id=$1", ticketID(5)); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tk := range list(AdminID, "?include_finished=true") {
		if tk.ID == ticketID(5) {
			found = true
			if tk.Approved || len(tk.Reviews) != 0 {
				t.Fatalf("earlier round votes leaked into the list: %+v", tk)
			}
		}
	}
	if !found {
		t.Fatal("seeded ticket 5 is missing from the include_finished list")
	}
	if _, err := f.pool.Exec(context.Background(), "UPDATE tickets SET round=1 WHERE id=$1", ticketID(5)); err != nil {
		t.Fatal(err)
	}

	expectIDs := func(query string, actor string, want ...int) {
		t.Helper()
		got := ids(list(actor, query))
		wanted := map[string]bool{}
		for _, n := range want {
			wanted[ticketID(n)] = true
		}
		if len(got) != len(wanted) {
			t.Fatalf("%s: got %d tickets, want %d (%v)", query, len(got), len(wanted), got)
		}
		for id := range wanted {
			if !got[id] {
				t.Fatalf("%s: missing %s", query, id)
			}
		}
	}
	expectIDs("?area="+areaID(2), ManagerID, 1)
	expectIDs("?area="+areaID(4)+"&include_finished=true", ManagerID, 3, 5)
	expectIDs("?assignee=me", ManagerID, 2, 6)
	expectIDs("?assignee="+AdminID+"&include_finished=true", ManagerID, 3, 4, 5)
	expectIDs("?type=artikel", ManagerID, 2, 4)
	expectIDs("?q=LEHRERZITATE", ManagerID, 2)
	expectIDs("?q=Vorschläge", ManagerID, 1)
	expectIDs("?q=%25", ManagerID)
	expectIDs("?q=_", ManagerID)
	for _, bad := range []string{"?area=x", "?assignee=x", "?type=epos"} {
		f.expect(f.do(ManagerID, http.MethodGet, "/api/v1/tickets"+bad, nil), http.StatusBadRequest, "filter "+bad)
	}
	d := f.detail(ticketID(5))
	statusSteps := []string{}
	for _, ev := range d.Events {
		if ev.Kind == "status" {
			statusSteps = append(statusSteps, ev.Detail)
		}
	}
	if len(statusSteps) != 3 || statusSteps[2] != "review->done" {
		t.Fatalf("seed status history: %v", statusSteps)
	}
	f.expect(f.do(ManagerID, http.MethodGet, "/api/v1/tickets/not-a-uuid", nil), http.StatusNotFound, "malformed id")
	f.expect(f.do(ManagerID, http.MethodGet, "/api/v1/tickets/00000000-0000-4000-8000-0000000000ee", nil), http.StatusNotFound, "unknown id")

	// Seed re-runs do not duplicate tickets or reset reviewer grants an admin changed.
	f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+areaID(1), map[string]any{"name": "Redaktion", "reviewer_ids": []string{}, "version": 1}), 200, "clear reviewers")
	if err := SeedWithIssuer(context.Background(), f.pool, "development", f.app.auth.issuer); err != nil {
		t.Fatal(err)
	}
	if n := len(list(AdminID, "?include_finished=true")); n != len(all) {
		t.Fatalf("re-seed changed ticket count: %d -> %d", len(all), n)
	}
	areas := decodeInto[[]Area](t, f.do(ManagerID, http.MethodGet, "/api/v1/areas", nil), 200)
	if len(areas[0].Reviewers) != 0 {
		t.Fatalf("re-seed restored removed reviewer: %+v", areas[0])
	}
}

func TestAreasAndReviewerAdministration(t *testing.T) {
	f := newTicketFixture(t)
	areas := decodeInto[[]Area](t, f.do(ManagerID, http.MethodGet, "/api/v1/areas", nil), 200)
	names := []string{"Redaktion", "Ideen", "Zitate", "Fotos", "Layout", "Werbung", "Druck", "Orga"}
	if len(areas) < len(names) {
		t.Fatalf("expected the %d seeded Bereiche, got %d", len(names), len(areas))
	}
	for i, name := range names {
		if areas[i].Name != name || areas[i].Position != i+1 || areas[i].Reviewers == nil {
			t.Fatalf("area %d: %+v", i, areas[i])
		}
	}
	for _, i := range []int{0, 3} {
		if len(areas[i].Reviewers) != 1 || areas[i].Reviewers[0].ID != ManagerID {
			t.Fatalf("Sam should review %s: %+v", areas[i].Name, areas[i].Reviewers)
		}
	}
	for _, i := range []int{1, 2, 4, 5, 6, 7} {
		if len(areas[i].Reviewers) != 0 {
			t.Fatalf("%s should have no seeded reviewers", areas[i].Name)
		}
	}
	// Managers read areas but cannot administer them.
	f.expect(f.do(ManagerID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": "Neu", "reviewer_ids": []string{}}), http.StatusForbidden, "manager creates area")
	f.expect(f.do(f.r1, http.MethodPatch, "/api/v1/admin/areas/"+areas[0].ID, map[string]any{"name": "Neu", "reviewer_ids": []string{}, "version": areas[0].Version}), http.StatusForbidden, "reviewer edits area")

	created := decodeInto[Area](t, f.do(AdminID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": "  Social Media ", "reviewer_ids": []string{f.r1, AdminID}}), 201)
	last := areas[len(areas)-1]
	if created.Name != "Social Media" || created.Position != last.Position+1 || created.Version != 1 || len(created.Reviewers) != 2 {
		t.Fatalf("created area: %+v (previous last position %d)", created, last.Position)
	}
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": "Social Media", "reviewer_ids": []string{}}), http.StatusConflict, "duplicate name")
	f.expect(f.do(AdminID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": " ", "reviewer_ids": []string{}}), http.StatusBadRequest, "blank name")

	// Reviewers must be admitted managers/admins and unique, for create and edit alike.
	invalid := map[string][]string{
		"student":         {MiaID},
		"pending manager": {f.pending},
		"unknown user":    {"00000000-0000-4000-8000-0000000000ee"},
		"not a uuid":      {"x"},
		"duplicate":       {f.r1, f.r1},
	}
	for name, ids := range invalid {
		f.expect(f.do(AdminID, http.MethodPost, "/api/v1/admin/areas", map[string]any{"name": "N " + name, "reviewer_ids": ids}), http.StatusBadRequest, "create with "+name)
		f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+created.ID, map[string]any{"name": created.Name, "reviewer_ids": ids, "version": created.Version}), http.StatusBadRequest, "edit with "+name)
	}
	unchanged := decodeInto[[]Area](t, f.do(ManagerID, http.MethodGet, "/api/v1/areas", nil), 200)
	for _, a := range unchanged {
		if a.ID == created.ID && (a.Version != created.Version || len(a.Reviewers) != 2 || a.Name != created.Name) {
			t.Fatalf("rejected edits changed the area: %+v", a)
		}
		if strings.HasPrefix(a.Name, "N ") {
			t.Fatalf("rejected create persisted an area: %+v", a)
		}
	}

	// A valid edit replaces the whole reviewer set, renames and bumps the version.
	edited := decodeInto[Area](t, f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+created.ID, map[string]any{"name": "Social", "reviewer_ids": []string{f.r2}, "version": created.Version}), 200)
	if edited.Name != "Social" || edited.Version != created.Version+1 || len(edited.Reviewers) != 1 || edited.Reviewers[0].ID != f.r2 {
		t.Fatalf("edited area: %+v", edited)
	}
	f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+created.ID, map[string]any{"name": "Social", "reviewer_ids": []string{}, "version": created.Version}), http.StatusConflict, "stale area version")
	f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/00000000-0000-4000-8000-0000000000ee", map[string]any{"name": "x", "reviewer_ids": []string{}, "version": 1}), http.StatusNotFound, "unknown area")
	cleared := decodeInto[Area](t, f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+created.ID, map[string]any{"name": "Social", "reviewer_ids": []string{}, "version": edited.Version}), 200)
	if len(cleared.Reviewers) != 0 {
		t.Fatalf("clearing reviewers failed: %+v", cleared)
	}
	// Reviewers who lose their role or admission no longer appear.
	withR2 := decodeInto[Area](t, f.do(AdminID, http.MethodPatch, "/api/v1/admin/areas/"+created.ID, map[string]any{"name": "Social", "reviewer_ids": []string{f.r2}, "version": cleared.Version}), 200)
	if _, err := f.pool.Exec(context.Background(), "UPDATE users SET role='student' WHERE id=$1", f.r2); err != nil {
		t.Fatal(err)
	}
	for _, a := range decodeInto[[]Area](t, f.do(ManagerID, http.MethodGet, "/api/v1/areas", nil), 200) {
		if a.ID == withR2.ID && len(a.Reviewers) != 0 {
			t.Fatalf("demoted reviewer still listed: %+v", a)
		}
	}
}

func TestDeleteUserWithTicketHistory(t *testing.T) {
	f := newTicketFixture(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := f.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	newTicket := func(creator string, assignee any) string {
		id := ID()
		exec("INSERT INTO tickets(id,type,title,area_id,created_by,size,goal) VALUES($1,'aufgabe','x',$2,$3,'S','g')", id, f.area, creator)
		if assignee != nil {
			exec("INSERT INTO ticket_assignees(ticket_id,user_id) VALUES($1,$2)", id, assignee)
		}
		return id
	}
	del := func(id string) *httptest.ResponseRecorder {
		return f.do(AdminID, http.MethodDelete, "/api/v1/admin/users/"+id, nil)
	}
	exists := func(id string) bool {
		var n int
		if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	creator, assignee, eventActor, voter := f.user("manager", true), f.user("manager", true), f.user("manager", true), f.user("manager", true)
	exec("INSERT INTO ticket_events(id,ticket_id,actor_id,kind) VALUES($1,$2,$3,'comment')", ID(), newTicket(AdminID, nil), eventActor)
	exec("INSERT INTO ticket_reviews(ticket_id,user_id,round,verdict,binding) VALUES($1,$2,1,'approve',false)", newTicket(AdminID, nil), voter)
	newTicket(creator, nil)
	newTicket(AdminID, assignee)
	for name, id := range map[string]string{"creator": creator, "assignee": assignee, "event actor": eventActor, "voter": voter} {
		res := del(id)
		if res.Code != http.StatusConflict || errorCode(res) != "has_content" || !exists(id) {
			t.Errorf("%s: delete status=%d code=%q exists=%v", name, res.Code, errorCode(res), exists(id))
		}
	}
	// A reviewer grant alone does not block deletion; it is removed with the user.
	reviewer := f.user("manager", true)
	exec("INSERT INTO area_reviewers(area_id,user_id) VALUES($1,$2)", f.area, reviewer)
	if res := del(reviewer); res.Code != http.StatusNoContent || exists(reviewer) {
		t.Fatalf("reviewer-only delete status=%d body=%s", res.Code, res.Body)
	}
	var grants int
	if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM area_reviewers WHERE user_id=$1", reviewer).Scan(&grants); err != nil || grants != 0 {
		t.Fatalf("grants after delete=%d err=%v", grants, err)
	}
	for _, a := range decodeInto[[]Area](t, f.do(AdminID, http.MethodGet, "/api/v1/areas", nil), 200) {
		for _, r := range a.Reviewers {
			if r.ID == reviewer {
				t.Fatalf("deleted reviewer still listed in %s", a.Name)
			}
		}
	}
}

func TestTicketClaimOnlyOpensOpenWork(t *testing.T) {
	f := newTicketFixture(t)
	ctx := context.Background()
	insert := func(status string) string {
		id := ID()
		if _, err := f.pool.Exec(ctx, "INSERT INTO tickets(id,type,title,area_id,created_by,size,goal,status) VALUES($1,'aufgabe','x',$2,$3,'S','g',$4)", id, f.area, AdminID, status); err != nil {
			t.Fatal(err)
		}
		return id
	}
	// An unassigned, approved done ticket stays done and approved when someone tries to claim it.
	done := insert("done")
	if _, err := f.pool.Exec(ctx, "INSERT INTO ticket_reviews(ticket_id,user_id,round,verdict,binding) VALUES($1,$2,1,'approve',true)", done, f.r1); err != nil {
		t.Fatal(err)
	}
	before := f.get(done)
	if !before.Approved || len(before.Assignees) > 0 {
		t.Fatalf("setup: %+v", before)
	}
	for _, who := range []string{f.m, AdminID, f.r1} {
		f.expect(f.do(who, http.MethodPost, "/api/v1/tickets/"+done+"/claim", nil), http.StatusConflict, "claim of done ticket")
	}
	if after := f.get(done); !after.Approved || after.Status != "done" || len(after.Assignees) > 0 || after.Round != before.Round || after.Version != before.Version {
		t.Fatalf("rejected claim changed the ticket: %+v", after)
	}
	review := insert("review")
	f.expect(f.do(f.m, http.MethodPost, "/api/v1/tickets/"+review+"/claim", nil), http.StatusConflict, "claim of ticket in review")
	// Open work can be claimed in both open columns.
	for _, status := range []string{"todo", "in_progress"} {
		claimed := decodeInto[Ticket](t, f.do(f.m, http.MethodPost, "/api/v1/tickets/"+insert(status)+"/claim", nil), 200)
		if claimed.Status != "in_progress" || len(claimed.Assignees) == 0 || claimed.Assignees[0].ID != f.m {
			t.Fatalf("claim from %s: %+v", status, claimed)
		}
	}
}

func TestTicketVoteIsBoundToTheRoundItWasCastFor(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.inReview(f.area, f.m, map[string]any{"type": "artikel", "est_pages": 2})
	if tk.Round != 1 {
		t.Fatalf("round=%d", tk.Round)
	}
	// The reviewer loaded round 1; meanwhile an est_pages edit starts round 2.
	edited := f.edit(AdminID, tk, map[string]any{"est_pages": 3})
	if edited.Round != 2 {
		t.Fatalf("round=%d after est_pages edit", edited.Round)
	}
	f.expect(f.voteRound(f.r1, tk.ID, 1, "approve", false), http.StatusConflict, "stale vote")
	f.expect(f.voteRound(f.r1, tk.ID, 3, "approve", false), http.StatusConflict, "vote for a future round")
	if got := f.get(tk.ID); got.Approved || len(got.Reviews) != 0 {
		t.Fatalf("stale vote counted in the new round: %+v", got.Reviews)
	}
	var rows int
	if err := f.pool.QueryRow(context.Background(), "SELECT count(*) FROM ticket_reviews WHERE ticket_id=$1", tk.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("stale vote was stored: rows=%d err=%v", rows, err)
	}
	// round is mandatory and must be positive.
	f.expect(f.do(f.r1, http.MethodPut, "/api/v1/tickets/"+tk.ID+"/review", map[string]any{"verdict": "approve"}), http.StatusBadRequest, "vote without round")
	f.expect(f.voteRound(f.r1, tk.ID, 0, "approve", false), http.StatusBadRequest, "vote with round 0")
	if got := decodeInto[Ticket](t, f.voteRound(f.r1, tk.ID, 2, "approve", false), 200); !got.Approved || got.Round != 2 {
		t.Fatalf("vote for the current round: %+v", got)
	}
}

func TestTicketAreaChangeNeedsAuthorityOverBothAreas(t *testing.T) {
	f := newTicketFixture(t)
	foreign := f.newArea(f.r2)
	shared := f.newArea(f.r1)
	tk := f.create(AdminID, f.body(f.area, f.m2, nil))
	// r1 reviews the source area only: moving a ticket into someone else's Bereich is refused.
	f.expect(f.editRaw(f.r1, tk, map[string]any{"area_id": foreign}), http.StatusForbidden, "reviewer moves into foreign area")
	if got := f.get(tk.ID); got.AreaID != f.area || got.Version != tk.Version || got.Round != tk.Round {
		t.Fatalf("refused move changed the ticket: %+v", got)
	}
	// Reviewing both areas (or being admin) allows the move.
	if got := f.edit(f.r1, tk, map[string]any{"area_id": shared}); got.AreaID != shared || got.Round != tk.Round+1 {
		t.Fatalf("move between reviewed areas: %+v", got)
	}
	if got := f.edit(AdminID, f.get(tk.ID), map[string]any{"area_id": foreign}); got.AreaID != foreign {
		t.Fatalf("admin move: %+v", got)
	}
}

func TestTicketPatchRequiresEveryKey(t *testing.T) {
	f := newTicketFixture(t)
	tk := f.create(AdminID, f.body(f.area, f.m, nil))
	full := editPayload(tk, nil)
	for key := range full {
		partial := map[string]any{}
		for k, v := range full {
			if k != key {
				partial[k] = v
			}
		}
		f.expect(f.do(AdminID, http.MethodPatch, "/api/v1/tickets/"+tk.ID, partial), http.StatusBadRequest, "PATCH without "+key)
	}
	f.expect(f.do(f.m, http.MethodPatch, "/api/v1/tickets/"+tk.ID, map[string]any{"title": "Nur Titel", "version": tk.Version}), http.StatusBadRequest, "partial PATCH by assignee")
	if got := f.get(tk.ID); got.Version != tk.Version || len(got.Assignees) == 0 || got.Title != tk.Title {
		t.Fatalf("partial PATCH changed the ticket: %+v", got)
	}
	// assignee_ids null must never read as "nobody": only an explicit empty list releases.
	f.expect(f.editRaw(AdminID, tk, map[string]any{"assignee_ids": nil}), http.StatusBadRequest, "assignee_ids null")
	if got := f.get(tk.ID); len(got.Assignees) != 1 {
		t.Fatalf("null assignee_ids changed the ticket: %+v", got)
	}
	released := f.edit(AdminID, tk, map[string]any{"assignee_ids": who()})
	if len(released.Assignees) > 0 {
		t.Fatalf("empty list did not release: %+v", released)
	}
}
