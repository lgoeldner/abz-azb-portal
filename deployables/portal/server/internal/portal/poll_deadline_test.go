package portal

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// deadlineSnapshot includes every stored definition field, options, current ballots
// and named history, while excluding the two fields a deadline edit may change.
func deadlineSnapshot(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var snapshot string
	err := pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
		'category',to_jsonb(c)-'closes_at'-'version',
		'options',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM poll_options o WHERE poll_id=c.id),
		'ballots',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.user_id,b.ballot_id,b.option_id) FROM ballots b WHERE poll_id=c.id),
		'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM ballot_audit h WHERE poll_id=c.id)
	)::text FROM categories c WHERE id=$1`, id).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPollDeadlineChangesPreserveLifecycleDefinitionsAndBallots(t *testing.T) {
	app, pool := timelineApp(t)
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	newDeadline := future.Add(2 * time.Hour)
	for _, kind := range []string{"person", "proposal", "words"} {
		for _, state := range []string{"draft", "open", "expired", "closed", "hidden"} {
			t.Run(kind+"/"+state, func(t *testing.T) {
				options := `[]`
				if kind == "proposal" {
					options = `[{"label":"A"},{"label":"B"}]`
				}
				body := fmt.Sprintf(`{"name":"Deadline test","description":"Original definition","kind":%q,"repeatable":true,"ongoing":false,"closes_at":%q,"max_choices":2,"allow_self_vote":true,"options":%s}`, kind, future.Format(time.RFC3339), options)
				poll := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)
				path := "/api/v1/categories/" + poll.ID
				status := func(status string) {
					t.Helper()
					poll = decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":%q}`, poll.Version, status)), http.StatusOK)
				}
				if state != "draft" {
					status("open")
					for i := 0; i < 2; i++ {
						var vote string
						if kind == "words" {
							vote = fmt.Sprintf(`{"words":["gut","freundlich"],"ballot_id":%q}`, ID())
						} else {
							vote = fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, poll.Options[i%len(poll.Options)].ID, ID())
						}
						res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", vote)
						if res.Code != http.StatusOK {
							t.Fatalf("setup ballot returned %d", res.Code)
						}
					}
					if state == "closed" {
						status("closed")
					}
					if state == "hidden" {
						status("draft")
					}
					if state == "expired" {
						if _, err := pool.Exec(context.Background(), "UPDATE categories SET closes_at=now()-interval '1 hour' WHERE id=$1", poll.ID); err != nil {
							t.Fatal(err)
						}
						if categoriesFor(t, app, ManagerID)[poll.ID].Status != "closed" {
							t.Fatal("expired open poll was not effectively closed")
						}
					}
				}
				before := deadlineSnapshot(t, pool, poll.ID)
				updated := decodeCategory(t, authenticatedRequest(t, app, pool, ManagerID, http.MethodPatch, path, fmt.Sprintf(`{"version":%d,"closes_at":%q}`, poll.Version, newDeadline.Format(time.RFC3339))), http.StatusOK)
				if updated.Version != poll.Version+1 || updated.ClosesAt == nil || !updated.ClosesAt.Equal(newDeadline) {
					t.Fatal("deadline edit did not persist the requested timestamp and increment version")
				}
				if updated.Status != poll.Status {
					t.Fatalf("deadline edit changed effective status: got %s want %s", updated.Status, poll.Status)
				}
				if deadlineSnapshot(t, pool, poll.ID) != before {
					t.Fatal("deadline edit mutated stored status, definition, candidates, ballots or named history")
				}
				if kind == "person" {
					// Editing a deadline must not refresh the frozen all-people snapshot.
					if _, err := pool.Exec(context.Background(), "UPDATE users SET name=name||' changed' WHERE id=$1", LeonID); err != nil {
						t.Fatal(err)
					}
				}
				// Another edit can shorten the deadline while keeping it in the future.
				updated = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, fmt.Sprintf(`{"version":%d,"closes_at":%q}`, updated.Version, future.Format(time.RFC3339))), http.StatusOK)
				if !updated.ClosesAt.Equal(future) || deadlineSnapshot(t, pool, poll.ID) != before {
					t.Fatal("a second deadline edit mutated preserved data")
				}
				if state == "expired" || state == "closed" {
					var vote string
					if kind == "words" {
						vote = fmt.Sprintf(`{"words":["neu"],"ballot_id":%q}`, ID())
					} else {
						vote = fmt.Sprintf(`{"option_id":%q,"ballot_id":%q}`, updated.Options[0].ID, ID())
					}
					want := http.StatusOK
					if state == "closed" {
						want = http.StatusConflict
					}
					if res := authenticatedRequest(t, app, pool, MiaID, http.MethodPut, path+"/ballot", vote); res.Code != want {
						t.Fatalf("voting after deadline edit returned %d want %d", res.Code, want)
					}
				}
			})
		}
	}
}

func TestPollDeadlineChangeRejectsUnauthorizedInvalidAndDefinitionEdits(t *testing.T) {
	app, pool := timelineApp(t)
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Locked","description":"Original","kind":"proposal","ongoing":false,"closes_at":%q,"options":[{"label":"A"},{"label":"B"}]}`, future.Format(time.RFC3339))), http.StatusCreated)
	path := "/api/v1/categories/" + poll.ID
	poll = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, path+"/status", fmt.Sprintf(`{"version":%d,"status":"open"}`, poll.Version)), http.StatusOK)
	before := deadlineSnapshot(t, pool, poll.ID)
	patch := fmt.Sprintf(`{"version":%d,"closes_at":%q}`, poll.Version, future.Add(time.Hour).Format(time.RFC3339))
	for _, actor := range []string{MiaID, ManagerID} {
		if res := authenticatedRequest(t, app, pool, actor, http.MethodPatch, path, patch); res.Code != http.StatusForbidden {
			t.Fatalf("unauthorized deadline edit returned %d", res.Code)
		}
	}
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"stale", fmt.Sprintf(`{"version":%d,"closes_at":%q}`, poll.Version-1, future.Format(time.RFC3339)), http.StatusConflict},
		{"past", fmt.Sprintf(`{"version":%d,"closes_at":%q}`, poll.Version, time.Now().Add(-time.Hour).Format(time.RFC3339)), http.StatusBadRequest},
		{"null", fmt.Sprintf(`{"version":%d,"closes_at":null}`, poll.Version), http.StatusBadRequest},
		{"invalid date", fmt.Sprintf(`{"version":%d,"closes_at":"tomorrow"}`, poll.Version), http.StatusBadRequest},
		{"unknown field", fmt.Sprintf(`{"version":%d,"closes_at":%q,"bogus":true}`, poll.Version, future.Format(time.RFC3339)), http.StatusBadRequest},
		{"missing deadline", fmt.Sprintf(`{"version":%d}`, poll.Version), http.StatusBadRequest},
		{"definition", fmt.Sprintf(`{"version":%d,"name":"Changed","description":"Original","kind":"proposal","closes_at":%q,"options":[{"label":"A"},{"label":"B"}]}`, poll.Version, future.Add(time.Hour).Format(time.RFC3339)), http.StatusConflict},
		{"extra false field", fmt.Sprintf(`{"version":%d,"closes_at":%q,"allow_self_vote":false}`, poll.Version, future.Format(time.RFC3339)), http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, tc.body); res.Code != tc.want {
				t.Fatalf("deadline edit returned %d want %d", res.Code, tc.want)
			}
			current := categoriesFor(t, app, AdminID)[poll.ID]
			if current.Version != poll.Version || current.ClosesAt == nil || !current.ClosesAt.Equal(future) || deadlineSnapshot(t, pool, poll.ID) != before {
				t.Fatal("rejected edit mutated the category or ballot data")
			}
		})
	}
	for _, kind := range []string{"proposal", "idea"} {
		body := fmt.Sprintf(`{"name":"Fixed schedule","description":"","kind":%q,"options":[]}`, kind)
		if kind == "proposal" {
			body = `{"name":"Ongoing ballot","description":"","kind":"proposal","options":[{"label":"A"},{"label":"B"}]}`
		}
		other := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", body), http.StatusCreated)
		if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, "/api/v1/categories/"+other.ID, fmt.Sprintf(`{"version":%d,"closes_at":%q}`, other.Version, future.Format(time.RFC3339))); res.Code != http.StatusBadRequest {
			t.Fatalf("deadline edit on ongoing %s returned %d", kind, res.Code)
		}
	}
}

func TestDraftPollDefinitionEditPreservesUnchangedExpiredDeadline(t *testing.T) {
	app, pool := timelineApp(t)
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	poll := decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPost, "/api/v1/categories", fmt.Sprintf(`{"name":"Draft","description":"","kind":"proposal","ongoing":false,"closes_at":%q,"options":[{"label":"A"},{"label":"B"}]}`, future.Format(time.RFC3339))), http.StatusCreated)
	past := future.Add(-2 * time.Hour)
	if _, err := pool.Exec(context.Background(), "UPDATE categories SET closes_at=$2 WHERE id=$1", poll.ID, past); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/categories/" + poll.ID
	body := fmt.Sprintf(`{"version":%d,"name":"Renamed","description":"","kind":"proposal","options":[{"label":"A"},{"label":"B"}]}`, poll.Version)
	poll = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, body), http.StatusOK)
	if poll.ClosesAt == nil || !poll.ClosesAt.Equal(past) || poll.Name != "Renamed" {
		t.Fatal("unrelated definition edit failed to preserve the omitted expired deadline")
	}
	body = fmt.Sprintf(`{"version":%d,"name":"Renamed with exact deadline","description":"","kind":"proposal","closes_at":%q,"options":[{"label":"A"},{"label":"B"}]}`, poll.Version, past.Format(time.RFC3339))
	poll = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, body), http.StatusOK)
	if poll.ClosesAt == nil || !poll.ClosesAt.Equal(past) {
		t.Fatal("unchanged explicit expired deadline was not preserved")
	}
	for _, deadline := range []string{fmt.Sprintf(`%q`, past.Add(-time.Hour).Format(time.RFC3339)), `null`} {
		body = fmt.Sprintf(`{"version":%d,"name":"Renamed","description":"","kind":"proposal","closes_at":%s,"options":[{"label":"A"},{"label":"B"}]}`, poll.Version, deadline)
		if res := authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, body); res.Code != http.StatusBadRequest {
			t.Fatalf("explicit invalid deadline on definition edit returned %d", res.Code)
		}
	}
	body = fmt.Sprintf(`{"version":%d,"name":"Renamed again","description":"","kind":"proposal","closes_at":%q,"options":[{"label":"A"},{"label":"B"}]}`, poll.Version, future.Format(time.RFC3339))
	poll = decodeCategory(t, authenticatedRequest(t, app, pool, AdminID, http.MethodPatch, path, body), http.StatusOK)
	if poll.ClosesAt == nil || !poll.ClosesAt.Equal(future) || poll.Name != "Renamed again" {
		t.Fatal("draft definition edit failed to update a future deadline")
	}
}
