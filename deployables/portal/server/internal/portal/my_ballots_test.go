package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func createMyBallotCategory(t *testing.T, pool *pgxpool.Pool, id, name, kind string, repeatable bool, maxChoices int) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `INSERT INTO categories
		(id,name,description,kind,repeatable,ongoing,status,allow_self_vote,all_people,max_choices)
		VALUES($1,$2,'',$3,$4,true,'open',true,false,$5)`, id, name, kind, repeatable, maxChoices)
	if err != nil {
		t.Fatal(err)
	}
}

func addMyBallotOptions(t *testing.T, pool *pgxpool.Pool, categoryID string, labels ...string) []string {
	t.Helper()
	ids := make([]string, len(labels))
	categoryNumber, err := strconv.Atoi(categoryID[len(categoryID)-3:])
	if err != nil {
		t.Fatal(err)
	}
	for i, label := range labels {
		ids[i] = fmt.Sprintf("81000000-0000-4000-8000-%012d", categoryNumber*10+i+1)
		if _, err := pool.Exec(context.Background(), "INSERT INTO poll_options(id,poll_id,label,position) VALUES($1,$2,$3,$4)", ids[i], categoryID, label, i); err != nil {
			t.Fatal(err)
		}
	}
	return ids
}

func castMyBallot(t *testing.T, app *App, pool *pgxpool.Pool, userID, categoryID, body string) {
	t.Helper()
	res := authenticatedRequest(t, app, pool, userID, http.MethodPut, "/api/v1/categories/"+categoryID+"/ballot", body)
	if res.Code != http.StatusOK {
		t.Fatalf("cast ballot for %s: status=%d body=%s", userID, res.Code, res.Body)
	}
}

func TestMyBallotsReturnsOnlyGroupedCurrentEntriesForEveryRole(t *testing.T) {
	app, pool := timelineApp(t)
	ctx := context.Background()

	proposal := "80000000-0000-4000-8000-000000000101"
	words := "80000000-0000-4000-8000-000000000102"
	replacement := "80000000-0000-4000-8000-000000000103"
	hidden := "80000000-0000-4000-8000-000000000104"
	closed := "80000000-0000-4000-8000-000000000105"
	expired := "80000000-0000-4000-8000-000000000106"
	unanswered := "80000000-0000-4000-8000-000000000107"
	createMyBallotCategory(t, pool, proposal, "Repeatable proposal", "proposal", true, 2)
	createMyBallotCategory(t, pool, words, "Word portrait", "words", true, 3)
	createMyBallotCategory(t, pool, replacement, "Replacement poll", "proposal", false, 2)
	createMyBallotCategory(t, pool, hidden, "Hidden poll", "proposal", true, 1)
	createMyBallotCategory(t, pool, closed, "Closed poll", "proposal", true, 1)
	createMyBallotCategory(t, pool, expired, "Expired poll", "proposal", true, 1)
	createMyBallotCategory(t, pool, unanswered, "Unanswered poll", "proposal", true, 1)
	proposalOptions := addMyBallotOptions(t, pool, proposal, "choice-secret-a", "choice-secret-b", "choice-secret-c")
	replacementOptions := addMyBallotOptions(t, pool, replacement, "replacement-secret-a", "replacement-secret-b")
	hiddenOption := addMyBallotOptions(t, pool, hidden, "hidden-secret")
	closedOption := addMyBallotOptions(t, pool, closed, "closed-secret")
	expiredOption := addMyBallotOptions(t, pool, expired, "expired-secret")
	addMyBallotOptions(t, pool, unanswered, "unanswered-secret")

	miaProposalFirst := "91000000-0000-4000-8000-000000000001"
	miaProposalSecond := "91000000-0000-4000-8000-000000000002"
	managerProposal := "91000000-0000-4000-8000-000000000003"
	adminProposal := "91000000-0000-4000-8000-000000000004"
	miaWords := "92000000-0000-4000-8000-000000000001"
	managerWords := "92000000-0000-4000-8000-000000000002"
	adminWords := "92000000-0000-4000-8000-000000000003"
	person := pollID(2)
	var personOption string
	if err := pool.QueryRow(ctx, "SELECT id::text FROM poll_options WHERE poll_id=$1 ORDER BY position OFFSET 1 LIMIT 1", person).Scan(&personOption); err != nil {
		t.Fatal(err)
	}
	miaHidden := "93000000-0000-4000-8000-000000000001"
	miaClosed := "93000000-0000-4000-8000-000000000002"
	miaExpired := "93000000-0000-4000-8000-000000000003"

	castMyBallot(t, app, pool, MiaID, proposal, fmt.Sprintf(`{"option_ids":[%q,%q],"ballot_id":%q}`, proposalOptions[0], proposalOptions[1], miaProposalFirst))
	castMyBallot(t, app, pool, MiaID, proposal, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, proposalOptions[2], miaProposalSecond))
	castMyBallot(t, app, pool, ManagerID, proposal, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, proposalOptions[1], managerProposal))
	castMyBallot(t, app, pool, AdminID, proposal, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, proposalOptions[0], adminProposal))
	castMyBallot(t, app, pool, MiaID, person, fmt.Sprintf(`{"option_id":%q}`, personOption))
	castMyBallot(t, app, pool, MiaID, words, fmt.Sprintf(`{"words":["mutig","laut","freundlich"],"ballot_id":%q}`, miaWords))
	castMyBallot(t, app, pool, ManagerID, words, fmt.Sprintf(`{"words":["hilfsbereit","klar"],"ballot_id":%q}`, managerWords))
	castMyBallot(t, app, pool, AdminID, words, fmt.Sprintf(`{"words":["neugierig"],"ballot_id":%q}`, adminWords))
	castMyBallot(t, app, pool, MiaID, replacement, fmt.Sprintf(`{"option_id":%q}`, replacementOptions[0]))
	castMyBallot(t, app, pool, MiaID, replacement, fmt.Sprintf(`{"option_id":%q}`, replacementOptions[1]))
	castMyBallot(t, app, pool, MiaID, replacement, fmt.Sprintf(`{"option_id":%q}`, replacementOptions[1])) // replay does not create another current row or history
	castMyBallot(t, app, pool, MiaID, hidden, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, hiddenOption[0], miaHidden))
	castMyBallot(t, app, pool, MiaID, closed, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, closedOption[0], miaClosed))
	castMyBallot(t, app, pool, MiaID, expired, fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, expiredOption[0], miaExpired))
	if _, err := pool.Exec(ctx, "UPDATE categories SET status='draft' WHERE id=$1", hidden); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE categories SET status='closed' WHERE id=$1", closed); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE categories SET closes_at=now()-interval '1 minute' WHERE id=$1", expired); err != nil {
		t.Fatal(err)
	}
	// Equal latest timestamps verify the stable category/key tie ordering. The
	// first multiselect ballot's other choice is deliberately older, so its
	// summary time must still be the maximum across the grouped rows.
	tiedAt := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pool.Exec(ctx, "UPDATE ballots SET created_at=$3 WHERE poll_id=$1 AND user_id=$2 AND ballot_id IN ($4,$5)", proposal, MiaID, tiedAt, miaProposalFirst, miaProposalSecond); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE ballots SET created_at=$3 WHERE poll_id=$1 AND user_id=$2 AND ballot_id=$4", words, MiaID, tiedAt, miaWords); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE ballots SET created_at=$3::timestamptz-interval '1 second' WHERE poll_id=$1 AND user_id=$2 AND ballot_id=$4 AND option_id=$5", proposal, MiaID, tiedAt, miaProposalFirst, proposalOptions[0]); err != nil {
		t.Fatal(err)
	}
	var currentRows, auditRows int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballots WHERE poll_id=$1 AND user_id=$2", replacement, MiaID).Scan(&currentRows); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ballot_audit WHERE poll_id=$1 AND user_id=$2", replacement, MiaID).Scan(&auditRows); err != nil {
		t.Fatal(err)
	}
	if currentRows != 1 || auditRows != 2 {
		t.Fatalf("replacement and replay left current_rows=%d audit_rows=%d; want one current row and two changed snapshots", currentRows, auditRows)
	}

	unauthenticated := httptest.NewRecorder()
	app.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/v1/me/ballots", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("request without session status=%d, want 401", unauthenticated.Code)
	}
	pending := authenticatedRequest(t, app, pool, PendingID, http.MethodGet, "/api/v1/me/ballots", "")
	if pending.Code != http.StatusForbidden {
		t.Fatalf("pending account status=%d, want 403", pending.Code)
	}
	empty := authenticatedRequest(t, app, pool, GuestID, http.MethodGet, "/api/v1/me/ballots", "")
	if empty.Code != http.StatusOK || strings.TrimSpace(empty.Body.String()) != "[]" {
		t.Fatalf("unanswered user response=%d %s, want 200 []", empty.Code, empty.Body)
	}

	read := func(userID string) ([]MyBallot, string) {
		t.Helper()
		res := authenticatedRequest(t, app, pool, userID, http.MethodGet, "/api/v1/me/ballots", "")
		if res.Code != http.StatusOK {
			t.Fatalf("GET /me/ballots as %s: status=%d body=%s", userID, res.Code, res.Body)
		}
		var out []MyBallot
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode /me/ballots as %s: %v", userID, err)
		}
		return out, res.Body.String()
	}
	mia, rawMia := read(MiaID)
	manager, _ := read(ManagerID)
	admin, _ := read(AdminID)
	if len(mia) != 8 {
		t.Fatalf("Mia summary has %d entries, want 8: %+v", len(mia), mia)
	}
	var miaReplacement string
	if err := pool.QueryRow(ctx, "SELECT ballot_id::text FROM ballots WHERE poll_id=$1 AND user_id=$2", replacement, MiaID).Scan(&miaReplacement); err != nil {
		t.Fatal(err)
	}
	var miaPerson string
	if err := pool.QueryRow(ctx, "SELECT ballot_id::text FROM ballots WHERE poll_id=$1 AND user_id=$2", person, MiaID).Scan(&miaPerson); err != nil {
		t.Fatal(err)
	}
	assertOnly := func(userID string, entries []MyBallot, want ...string) {
		t.Helper()
		got := make([]string, len(entries))
		for i, entry := range entries {
			got[i] = entry.ID
			if entry.ID == "" || entry.CategoryID == "" || entry.CategoryName == "" || entry.CategoryKind == "" || entry.CategoryStatus == "" || entry.CreatedAt.IsZero() {
				t.Errorf("%s got incomplete ballot summary: %+v", userID, entry)
			}
			if entry.CategoryKind != "person" && entry.CategoryKind != "proposal" && entry.CategoryKind != "words" {
				t.Errorf("unexpected ballot kind %q", entry.CategoryKind)
			}
		}
		sort.Strings(got)
		sort.Strings(want)
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("%s entries have ids %v, want %v", userID, got, want)
		}
	}
	assertOnly(MiaID, mia, miaProposalFirst, miaProposalSecond, miaWords, miaReplacement, miaPerson, miaHidden, miaClosed, miaExpired)
	if len(manager) != 2 {
		t.Fatalf("manager summary has %d entries, want 2", len(manager))
	}
	assertOnly(ManagerID, manager, managerProposal, managerWords)
	if len(admin) != 2 {
		t.Fatalf("admin summary has %d entries, want 2", len(admin))
	}
	assertOnly(AdminID, admin, adminProposal, adminWords)

	for _, entry := range mia {
		switch entry.CategoryID {
		case hidden:
			if entry.CategoryStatus != "draft" {
				t.Errorf("hidden category status=%q, want draft", entry.CategoryStatus)
			}
		case closed, expired:
			if entry.CategoryStatus != "closed" {
				t.Errorf("closed category %s status=%q, want closed", entry.CategoryID, entry.CategoryStatus)
			}
		case unanswered:
			t.Error("unanswered category appeared in current ballots")
		}
	}
	for i := 1; i < len(mia); i++ {
		if mia[i].CreatedAt.After(mia[i-1].CreatedAt) {
			t.Errorf("entries are not sorted newest first: %+v then %+v", mia[i-1], mia[i])
		}
	}
	tieOrder := []string{}
	for _, entry := range mia {
		if entry.CreatedAt.Equal(tiedAt) {
			tieOrder = append(tieOrder, entry.CategoryID+"/"+entry.ID)
		}
	}
	wantTieOrder := []string{proposal + "/" + miaProposalFirst, proposal + "/" + miaProposalSecond, words + "/" + miaWords}
	if fmt.Sprint(tieOrder) != fmt.Sprint(wantTieOrder) {
		t.Errorf("equal-timestamp summaries ordered %v, want %v", tieOrder, wantTieOrder)
	}

	var shape []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(rawMia), &shape); err != nil {
		t.Fatal(err)
	}
	for _, item := range shape {
		if len(item) != 6 {
			t.Errorf("summary exposed fields beyond the six-field contract: %v", item)
		}
		for _, key := range []string{"id", "category_id", "category_name", "category_kind", "category_status", "created_at"} {
			if item[key] == nil {
				t.Errorf("summary lacks %q: %v", key, item)
			}
		}
	}
	for _, privateValue := range []string{MiaID, LeonID, ManagerID, AdminID, "Leon Fischer", "choice-secret", "replacement-secret", "hidden-secret", "closed-secret", "expired-secret", "mutig", "freundlich", "hilfsbereit", "neugierig", managerProposal, adminProposal} {
		if strings.Contains(rawMia, privateValue) {
			t.Errorf("summary response leaked private value %q", privateValue)
		}
	}
	for _, entry := range mia {
		var wantTime time.Time
		if err := pool.QueryRow(ctx, "SELECT max(created_at) FROM ballots WHERE poll_id=$1 AND user_id=$2 AND ballot_id=$3", entry.CategoryID, MiaID, entry.ID).Scan(&wantTime); err != nil {
			t.Fatal(err)
		}
		if !entry.CreatedAt.Equal(wantTime) {
			t.Errorf("entry %s created_at=%s, want max current-row timestamp %s", entry.ID, entry.CreatedAt, wantTime)
		}
	}
}
