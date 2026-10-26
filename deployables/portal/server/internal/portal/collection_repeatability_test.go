package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func createPhotoCategory(t *testing.T, app *App, pool *pgxpool.Pool, repeatable *bool) Category {
	t.Helper()
	body := `{"name":"Foto-Archiv","description":"","kind":"photo"}`
	if repeatable != nil {
		body = fmt.Sprintf(`{"name":"Foto-Archiv","description":"","kind":"photo","repeatable":%t}`, *repeatable)
	}
	return decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)
}

func createContribution(t *testing.T, app *App, pool *pgxpool.Pool, author, category, key, title string) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"idempotency_key":%q,"category_id":%q,"title":%q,"body":"Text","context":""}`, key, category, title)
	return authenticatedRequest(t, app, pool, author, http.MethodPost, "/api/v1/submissions", body)
}

func editContributionBody(version int, category, title string) string {
	return fmt.Sprintf(`{"version":%d,"category_id":%q,"title":%q,"body":"Bearbeiteter Text","context":""}`, version, category, title)
}

func TestOneOffContributionCapAndIdempotentRetries(t *testing.T) {
	app, pool := timelineApp(t)
	oneOff := createPhotoCategory(t, app, pool, boolPtr(false))
	if oneOff.Repeatable || oneOff.Status != "open" {
		t.Fatalf("one-off photo category: repeatable=%t status=%s", oneOff.Repeatable, oneOff.Status)
	}

	first := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0001", "Original")
	if first.Code != http.StatusCreated {
		t.Fatalf("first contribution: %d %s", first.Code, first.Body)
	}
	created := decodeSubmission(t, first)
	retry := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0001", "Original")
	if retry.Code != http.StatusOK || decodeSubmission(t, retry).ID != created.ID {
		t.Fatalf("idempotent retry after cap: %d %s", retry.Code, retry.Body)
	}
	if changed := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0001", "Changed"); changed.Code != http.StatusConflict {
		t.Fatalf("changed idempotency payload: %d %s", changed.Code, changed.Body)
	}

	edit := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+created.ID, editContributionBody(created.Version, oneOff.ID, "Edited original"))
	if edit.Code != http.StatusOK {
		t.Fatalf("edit existing contribution at cap: %d %s", edit.Code, edit.Body)
	}
	if duplicate := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0002", "Second"); duplicate.Code != http.StatusBadRequest {
		t.Fatalf("second one-off contribution: %d %s", duplicate.Code, duplicate.Body)
	}
	if withdraw := authenticatedRequest(t, app, pool, MiaID, http.MethodPost, "/api/v1/submissions/"+created.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"withdrawn"}`, created.Version+1)); withdraw.Code != http.StatusOK {
		t.Fatalf("withdraw original contribution: %d %s", withdraw.Code, withdraw.Body)
	}
	if retry := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0001", "Original"); retry.Code != http.StatusOK {
		t.Fatalf("idempotent retry after withdrawal and cap: %d %s", retry.Code, retry.Body)
	}
	if duplicate := createContribution(t, app, pool, MiaID, oneOff.ID, "photo-once-0003", "Third"); duplicate.Code != http.StatusBadRequest {
		t.Fatalf("withdrawn contribution did not count toward cap: %d %s", duplicate.Code, duplicate.Body)
	}

	// Omitted repeatable on edit preserves the explicitly selected one-off flag.
	editedCategory := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+oneOff.ID, fmt.Sprintf(`{"name":"Foto-Archiv neu","description":"","kind":"photo","version":%d,"options":[]}`, oneOff.Version)), http.StatusOK)
	if editedCategory.Repeatable {
		t.Fatal("omitted repeatable flag reset an existing one-off category")
	}
	change := fmt.Sprintf(`{"name":"Foto-Archiv","description":"","kind":"photo","repeatable":true,"version":%d,"options":[]}`, editedCategory.Version)
	if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+oneOff.ID, change); res.Code != http.StatusBadRequest {
		t.Fatalf("repeatable flag changed after creation: %d %s", res.Code, res.Body)
	}
}

func TestRepeatableContributionDefaultAndMultipleSubmissions(t *testing.T) {
	app, pool := timelineApp(t)
	repeatable := createPhotoCategory(t, app, pool, nil)
	if !repeatable.Repeatable {
		t.Fatal("photo category without explicit flag did not keep its legacy repeatable default")
	}
	first := createContribution(t, app, pool, MiaID, repeatable.ID, "photo-many-0001", "First")
	second := createContribution(t, app, pool, MiaID, repeatable.ID, "photo-many-0002", "Second")
	if first.Code != http.StatusCreated || second.Code != http.StatusCreated {
		t.Fatalf("repeatable contributions: first=%d %s second=%d %s", first.Code, first.Body, second.Code, second.Body)
	}
	edited := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+repeatable.ID, fmt.Sprintf(`{"name":"Foto-Archiv bearbeitet","description":"","kind":"photo","options":[],"version":%d}`, repeatable.Version)), http.StatusOK)
	if !edited.Repeatable {
		t.Fatal("omitted repeatable flag reset the legacy default")
	}
}

func TestRepeatabilityFlagDoesNotChangeBallotBehavior(t *testing.T) {
	app, pool := timelineApp(t)
	proposal := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Motto","description":"","kind":"proposal","repeatable":true,"options":[{"label":"A"},{"label":"B"}]}`), http.StatusCreated)
	if !proposal.Repeatable || proposal.Status != "draft" || len(proposal.Options) != 2 {
		t.Fatalf("repeatable ballot category: %+v", proposal)
	}
	opened := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+proposal.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, proposal.Version)), http.StatusOK)
	if opened.Status != "open" {
		t.Fatalf("ballot lifecycle changed with repeatable flag: %s", opened.Status)
	}
	ballotID1 := "90000000-0000-4000-8000-000000000001"
	cast := func(optionID, ballotID string) *httptest.ResponseRecorder {
		t.Helper()
		body := fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, optionID, ballotID)
		return authenticatedRequest(t, app, pool, MiaID, http.MethodPut, "/api/v1/categories/"+proposal.ID+"/ballot", body)
	}
	if vote := cast(proposal.Options[0].ID, ballotID1); vote.Code != http.StatusOK {
		t.Fatalf("repeatable ballot vote: %d %s", vote.Code, vote.Body)
	}
	if retry := cast(proposal.Options[0].ID, ballotID1); retry.Code != http.StatusOK {
		t.Fatalf("idempotent ballot retry: %d %s", retry.Code, retry.Body)
	}
	if changed := cast(proposal.Options[1].ID, ballotID1); changed.Code != http.StatusConflict {
		t.Fatalf("changed selection with same ballot_id: %d %s", changed.Code, changed.Body)
	}
	ballotID2 := "90000000-0000-4000-8000-000000000002"
	if vote := cast(proposal.Options[1].ID, ballotID2); vote.Code != http.StatusOK {
		t.Fatalf("second independent ballot: %d %s", vote.Code, vote.Body)
	}
	if current := categoriesFor(t, app, MiaID)[proposal.ID]; current.MyOptionIDs[0] != proposal.Options[1].ID {
		t.Fatalf("latest repeatable selection not returned: %v", current.MyOptionIDs)
	}
	if count := categoriesFor(t, app, AdminID)[proposal.ID].BallotCount; count == nil || *count != 1 {
		t.Fatalf("repeatable ballot count should count voters: %v", count)
	}
	var results []PollResult
	if response := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+proposal.ID+"/results", ""); response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &results) != nil || len(results) != 2 || results[0].Count != 1 || results[1].Count != 1 {
		t.Fatalf("repeatable ballot results did not count every selection: %d %s %+v", response.Code, response.Body, results)
	}
	var history []BallotAudit
	if response := authenticatedRequest(t, app, pool, AdminID, http.MethodGet, "/api/v1/categories/"+proposal.ID+"/audit", ""); response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &history) != nil || len(history) != 2 {
		t.Fatalf("repeatable ballot audit: %d %s %+v", response.Code, response.Body, history)
	}
	ids := map[string]bool{}
	for _, entry := range history {
		if entry.BallotID == nil {
			t.Fatal("repeatable ballot audit lost ballot_id")
		}
		ids[*entry.BallotID] = true
	}
	if len(ids) != 2 {
		t.Fatalf("repeatable ballot history did not preserve each cast: %v", ids)
	}
	closed := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+proposal.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, opened.Version))
	if closed.Code != http.StatusOK {
		t.Fatalf("close repeatable ballot: %d %s", closed.Code, closed.Body)
	}
	if retry := cast(proposal.Options[0].ID, ballotID1); retry.Code != http.StatusOK {
		t.Fatalf("idempotent ballot retry after close: %d %s", retry.Code, retry.Body)
	}
}

func TestScheduledCategoriesAndClosedContributionEditing(t *testing.T) {
	app, pool := timelineApp(t)
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	futureText := future.Format(time.RFC3339)
	if result := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", `{"name":"Missing deadline","description":"","kind":"photo","ongoing":false}`); result.Code != http.StatusBadRequest {
		t.Fatalf("non-ongoing category without deadline: %d %s", result.Code, result.Body)
	}
	expiredText := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	if result := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Expired deadline","description":"","kind":"photo","ongoing":false,"closes_at":%q}`, expiredText)); result.Code != http.StatusBadRequest {
		t.Fatalf("non-ongoing category with expired deadline: %d %s", result.Code, result.Body)
	}
	category := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Scheduled photos","description":"","kind":"photo","ongoing":false,"repeatable":false,"closes_at":%q}`, futureText)), http.StatusCreated)
	if category.Status != "draft" || category.Ongoing || category.ClosesAt == nil || !category.ClosesAt.Equal(future) {
		t.Fatalf("scheduled category creation: %+v", category)
	}
	if blocked := createContribution(t, app, pool, MiaID, category.ID, "scheduled-before-open", "Too early"); blocked.Code != http.StatusBadRequest {
		t.Fatalf("contribution into draft: %d %s", blocked.Code, blocked.Body)
	}
	opened := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+category.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, category.Version)), http.StatusOK)
	submissionResponse := createContribution(t, app, pool, MiaID, category.ID, "scheduled-open-0001", "Open contribution")
	if submissionResponse.Code != http.StatusCreated {
		t.Fatalf("contribution after opening: %d %s", submissionResponse.Code, submissionResponse.Body)
	}
	submission := decodeSubmission(t, submissionResponse)
	closed := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+category.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"closed"}`, opened.Version)), http.StatusOK)
	if closed.Status != "closed" {
		t.Fatalf("manual close: %s", closed.Status)
	}
	if blocked := createContribution(t, app, pool, MiaID, category.ID, "scheduled-after-close", "Too late"); blocked.Code != http.StatusBadRequest {
		t.Fatalf("contribution into closed category: %d %s", blocked.Code, blocked.Body)
	}
	edit := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+submission.ID, editContributionBody(submission.Version, category.ID, "Edited after close"))
	if edit.Code != http.StatusOK {
		t.Fatalf("edit original after close: %d %s", edit.Code, edit.Body)
	}
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatal(err)
	}
	if upload := authenticatedFileUpload(t, app, pool, MiaID, "/api/v1/submissions/"+submission.ID+"/attachments", submission.Version+1, "after-close.jpg", jpegData.Bytes()); upload.Code != http.StatusOK {
		t.Fatalf("upload original after close: %d %s", upload.Code, upload.Body)
	}

	expiring := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Expiring photos","description":"","kind":"photo","ongoing":false,"closes_at":%q}`, futureText)), http.StatusCreated)
	if _, err := pool.Exec(context.Background(), "UPDATE categories SET closes_at=now()-interval '1 second' WHERE id=$1", expiring.ID); err != nil {
		t.Fatal(err)
	}
	if got := categoriesFor(t, app, AdminID)[expiring.ID]; got.Status != "draft" {
		t.Fatalf("scheduled draft should stay draft until opened, got %s", got.Status)
	}
	if result := authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+expiring.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, expiring.Version)); result.Code != http.StatusConflict {
		t.Fatalf("opening after deadline: %d %s", result.Code, result.Body)
	}

	openThenExpire := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Opened then expired","description":"","kind":"photo","ongoing":false,"closes_at":%q}`, futureText)), http.StatusCreated)
	openThenExpire = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories/"+openThenExpire.ID+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, openThenExpire.Version)), http.StatusOK)
	if _, err := pool.Exec(context.Background(), "UPDATE categories SET closes_at=now()-interval '1 second' WHERE id=$1", openThenExpire.ID); err != nil {
		t.Fatal(err)
	}
	if got := categoriesFor(t, app, AdminID)[openThenExpire.ID]; got.Status != "closed" {
		t.Fatalf("elapsed deadline should read as closed, got %s", got.Status)
	}
	if blocked := createContribution(t, app, pool, MiaID, openThenExpire.ID, "expired-open-0001", "Too late"); blocked.Code != http.StatusBadRequest {
		t.Fatalf("contribution after scheduled deadline: %d %s", blocked.Code, blocked.Body)
	}
}

func TestOneOffContributionCapSerializesConcurrentCreatesAndMoves(t *testing.T) {
	app, pool := timelineApp(t)
	oneOff := createPhotoCategory(t, app, pool, boolPtr(false))
	var wait sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			results <- createContribution(t, app, pool, MiaID, oneOff.ID, fmt.Sprintf("photo-race-%04d", i), fmt.Sprintf("Concurrent %d", i))
		}(i)
	}
	wait.Wait()
	close(results)
	created, rejected := 0, 0
	for result := range results {
		switch result.Code {
		case http.StatusCreated:
			created++
		case http.StatusBadRequest:
			rejected++
		default:
			t.Fatalf("unexpected concurrent create result: %d %s", result.Code, result.Body)
		}
	}
	if created != 1 || rejected != 1 {
		t.Fatalf("concurrent one-off creates: created=%d rejected=%d", created, rejected)
	}

	// A contribution can move into an empty one-off category, but not into one
	// where the same author already has a contribution (including withdrawn rows).
	other := createPhotoCategory(t, app, pool, boolPtr(false))
	first := createContribution(t, app, pool, MiaID, other.ID, "photo-move-0001", "Move slot")
	if first.Code != http.StatusCreated {
		t.Fatalf("create one-off move slot: %d %s", first.Code, first.Body)
	}
	second := createContribution(t, app, pool, MiaID, categoryID(1), "idea-move-0001", "Idea to move")
	if second.Code != http.StatusCreated {
		t.Fatalf("create repeatable source contribution: %d %s", second.Code, second.Body)
	}
	secondSubmission := decodeSubmission(t, second)
	moveBody := editContributionBody(secondSubmission.Version, other.ID, "Move into full category")
	if moved := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+secondSubmission.ID, moveBody); moved.Code != http.StatusBadRequest {
		t.Fatalf("move into occupied one-off category: %d %s", moved.Code, moved.Body)
	}

	// Moving the original to a free one-off category succeeds and editing it in
	// place remains possible because the count excludes that same record.
	free := createPhotoCategory(t, app, pool, boolPtr(false))
	moved := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+secondSubmission.ID, editContributionBody(secondSubmission.Version, free.ID, "Move into free category"))
	if moved.Code != http.StatusOK {
		t.Fatalf("move into free one-off category: %d %s", moved.Code, moved.Body)
	}
	if edited := authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+secondSubmission.ID, editContributionBody(secondSubmission.Version+1, free.ID, "Edit moved original")); edited.Code != http.StatusOK {
		t.Fatalf("edit moved original at cap: %d %s", edited.Code, edited.Body)
	}

	moveTarget := createPhotoCategory(t, app, pool, boolPtr(false))
	otherSource := createContribution(t, app, pool, MiaID, categoryID(1), "photo-race-move-0001", "Second source")
	if otherSource.Code != http.StatusCreated {
		t.Fatalf("create second move source: %d %s", otherSource.Code, otherSource.Body)
	}
	secondSource := decodeSubmission(t, otherSource)
	var moves sync.WaitGroup
	moveResults := make(chan *httptest.ResponseRecorder, 2)
	for _, item := range []Submission{{ID: "20000000-0000-4000-8000-000000000001", Version: 1}, secondSource} {
		moves.Add(1)
		go func(item Submission) {
			defer moves.Done()
			moveResults <- authenticatedRequest(t, app, pool, MiaID, http.MethodPatch, "/api/v1/submissions/"+item.ID, editContributionBody(item.Version, moveTarget.ID, "Concurrent move"))
		}(item)
	}
	moves.Wait()
	close(moveResults)
	moveSuccess, moveRejected := 0, 0
	for result := range moveResults {
		switch result.Code {
		case http.StatusOK:
			moveSuccess++
		case http.StatusBadRequest:
			moveRejected++
		default:
			t.Fatalf("unexpected concurrent move result: %d %s", result.Code, result.Body)
		}
	}
	if moveSuccess != 1 || moveRejected != 1 {
		t.Fatalf("concurrent one-off moves: succeeded=%d rejected=%d", moveSuccess, moveRejected)
	}
}

func TestMigration007PreservesExistingCollectionData(t *testing.T) {
	pool, _ := migrateTo(t, "006_proposal_multiselect.sql")
	ctx := context.Background()
	const (
		admin   = "50000000-0000-4000-8000-000000000001"
		manager = "50000000-0000-4000-8000-000000000002"
		author  = "50000000-0000-4000-8000-000000000003"
		idea    = "10000000-0000-4000-8000-000000000001"
		poll    = "30000000-0000-4000-8000-000000000001"
		sub     = "20000000-0000-4000-8000-000000000001"
		optionA = "40000000-0000-4000-8000-000000000001"
		optionB = "40000000-0000-4000-8000-000000000002"
		ballot  = "60000000-0000-4000-8000-000000000001"
	)
	for _, query := range []string{
		"INSERT INTO users(id,subject,name,role,admitted,cohort_member,category_ids) VALUES ('" + admin + "','admin','Admin','admin',true,true,'{}'),('" + manager + "','manager','Manager','manager',true,true,'{" + idea + "," + poll + "}'),('" + author + "','author','Author','student',true,true,'{}')",
		"INSERT INTO categories(id,name,description,kind,status,allow_self_vote,version,created_at,opened_at,all_people,max_choices) VALUES ('" + idea + "','Ideen','','idea','open',false,3,now(),now(),false,1),('" + poll + "','Abimotto','','proposal','open',true,4,now(),now(),false,2)",
		"INSERT INTO submissions(id,category_id,author_id,title,body,context,status,version,idempotency_key,request_hash) VALUES ('" + sub + "','" + idea + "','" + author + "','Original','Text','Kontext','accepted',2,'seed-00000001','saved-hash')",
		"INSERT INTO poll_options(id,poll_id,label,position) VALUES ('" + optionA + "','" + poll + "','Blau',0),('" + optionB + "','" + poll + "','Gold',1)",
		"INSERT INTO ballots(poll_id,user_id,option_id) VALUES ('" + poll + "','" + author + "','" + optionA + "')",
		"INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id) VALUES ('70000000-0000-4000-8000-000000000001','" + poll + "','" + author + "','" + optionA + "','" + ballot + "')",
	} {
		if _, err := pool.Exec(ctx, query); err != nil {
			t.Fatalf("prepare pre-007 records: %v", err)
		}
	}

	snapshot := func(name, query string) string {
		t.Helper()
		var data string
		if err := pool.QueryRow(ctx, query).Scan(&data); err != nil {
			t.Fatalf("snapshot %s: %v", name, err)
		}
		return data
	}
	queries := map[string]string{
		"categories":   `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb)::text FROM (SELECT id,name,description,kind,status,allow_self_vote,all_people,max_choices,version,created_at,opened_at FROM categories) r`,
		"users":        `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb)::text FROM (SELECT id,category_ids FROM users) r`,
		"submissions":  `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb)::text FROM (SELECT id,category_id,author_id,title,body,context,status,version,idempotency_key,request_hash,created_at,updated_at FROM submissions) r`,
		"poll_options": `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb)::text FROM poll_options r`,
		"ballots":      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM (SELECT poll_id,user_id,option_id,created_at FROM ballots) r`,
		"ballot_audit": `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id::text),'[]'::jsonb)::text FROM ballot_audit r`,
	}
	before := map[string]string{}
	for table, query := range queries {
		before[table] = snapshot(table, query)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for table, query := range queries {
		if got := snapshot(table, query); got != before[table] {
			t.Fatalf("migration changed existing %s", table)
		}
	}
	var ideaRepeatable, pollRepeatable, ideaOngoing, pollOngoing bool
	if err := pool.QueryRow(ctx, "SELECT repeatable,ongoing FROM categories WHERE id=$1", idea).Scan(&ideaRepeatable, &ideaOngoing); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT repeatable,ongoing FROM categories WHERE id=$1", poll).Scan(&pollRepeatable, &pollOngoing); err != nil {
		t.Fatal(err)
	}
	if !ideaRepeatable || pollRepeatable || !ideaOngoing || !pollOngoing {
		t.Fatalf("legacy collection flags: idea=(repeatable=%t ongoing=%t) proposal=(repeatable=%t ongoing=%t)", ideaRepeatable, ideaOngoing, pollRepeatable, pollOngoing)
	}
	var activeBallotID, auditBallotID string
	if err := pool.QueryRow(ctx, "SELECT b.ballot_id::text,a.ballot_id::text FROM ballots b JOIN ballot_audit a USING(poll_id,user_id,option_id) WHERE b.poll_id=$1 AND b.user_id=$2", poll, author).Scan(&activeBallotID, &auditBallotID); err != nil {
		t.Fatal(err)
	}
	if activeBallotID != ballot || auditBallotID != ballot {
		t.Fatalf("migration did not associate current ballot with its saved history: current=%s audit=%s", activeBallotID, auditBallotID)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO categories(id,name,description,kind) VALUES('10000000-0000-4000-8000-000000000002','New photo','','photo')"); err != nil {
		t.Fatal(err)
	}
	var defaultRepeatable, defaultOngoing bool
	if err := pool.QueryRow(ctx, "SELECT repeatable,ongoing FROM categories WHERE id='10000000-0000-4000-8000-000000000002'").Scan(&defaultRepeatable, &defaultOngoing); err != nil {
		t.Fatal(err)
	}
	if !defaultRepeatable || !defaultOngoing {
		t.Fatalf("omitted direct SQL category flags: repeatable=%t ongoing=%t", defaultRepeatable, defaultOngoing)
	}
}

func boolPtr(value bool) *bool { return &value }

func decodeSubmission(t *testing.T, res *httptest.ResponseRecorder) Submission {
	t.Helper()
	if res.Code != http.StatusCreated && res.Code != http.StatusOK {
		t.Fatalf("submission status=%d: %s", res.Code, res.Body)
	}
	var submission Submission
	if err := json.NewDecoder(res.Body).Decode(&submission); err != nil {
		t.Fatal(err)
	}
	return submission
}
