package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type contractOperation struct{ method, path string }

// contractOperations lists every API operation from docs/openapi.json, so new
// routes are covered by the access invariants without editing this test.
func contractOperations(t *testing.T) []contractOperation {
	t.Helper()
	raw, err := os.ReadFile("../../../../../docs/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	ops := []contractOperation{{http.MethodPost, "/auth/logout"}}
	for path, methods := range doc.Paths {
		for method := range methods {
			switch method {
			case "get", "post", "put", "patch", "delete":
				ops = append(ops, contractOperation{strings.ToUpper(method), concretePath(path)})
			}
		}
	}
	if len(ops) < 20 {
		t.Fatalf("only %d operations parsed from the contract", len(ops))
	}
	return ops
}

// concretePath fills path parameters with seeded fixture IDs so requests reach handlers.
func concretePath(path string) string {
	ids := map[string]string{
		"categories":  categoryID(1),
		"submissions": "20000000-0000-4000-8000-000000000001",
		"users":       MiaID,
		"attachments": "50000000-0000-4000-8000-0000000000ff",
	}
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if part == "{id}" {
			parts[i] = ids[parts[i-1]]
		} else if strings.HasPrefix(part, "{") {
			parts[i] = "50000000-0000-4000-8000-0000000000fe"
		}
	}
	return strings.Join(parts, "/")
}

func sessionFor(t *testing.T, app *App, userID string) (token, csrf string) {
	t.Helper()
	token, csrf = randomToken(), randomToken()
	if _, err := app.DB.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)", digest(token), userID, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return token, csrf
}

func send(app *App, op contractOperation, token, csrf, origin string) *httptest.ResponseRecorder {
	return sendBody(app, op, token, csrf, origin, "{}")
}

func sendBody(app *App, op contractOperation, token, csrf, origin, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(op.method, op.path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "portal_session", Value: token})
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res := httptest.NewRecorder()
	app.ServeHTTP(res, req)
	return res
}

func errorCode(res *httptest.ResponseRecorder) string {
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.Unmarshal(res.Body.Bytes(), &body)
	return body.Error.Code
}

// Every contract operation requires a live session, an admitted account and,
// for unsafe methods, a matching CSRF token and same-origin request.
func TestEveryContractOperationEnforcesSessionAdmissionAndCSRF(t *testing.T) {
	app, _ := timelineApp(t)
	pendingToken, pendingCSRF := sessionFor(t, app, PendingID)
	miaToken, miaCSRF := sessionFor(t, app, MiaID)
	expiredToken, expiredCSRF := sessionFor(t, app, AdminID)
	if _, err := app.DB.Exec(context.Background(), "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", digest(expiredToken)); err != nil {
		t.Fatal(err)
	}
	for _, op := range contractOperations(t) {
		name := op.method + " " + op.path
		if res := send(app, op, "", "", ""); res.Code != http.StatusUnauthorized {
			t.Errorf("%s without session: status=%d", name, res.Code)
		}
		if res := send(app, op, "forged-session-token", "x", ""); res.Code != http.StatusUnauthorized {
			t.Errorf("%s with unknown session: status=%d", name, res.Code)
		}
		if res := send(app, op, expiredToken, expiredCSRF, ""); res.Code != http.StatusUnauthorized {
			t.Errorf("%s with expired session: status=%d", name, res.Code)
		}
		if op.path != "/api/v1/me" && op.path != "/auth/logout" {
			if res := send(app, op, pendingToken, pendingCSRF, ""); res.Code != http.StatusForbidden {
				t.Errorf("%s as pending account: status=%d", name, res.Code)
			}
		}
		if op.method == http.MethodGet {
			continue
		}
		if res := send(app, op, miaToken, "", ""); res.Code != http.StatusForbidden || errorCode(res) != "csrf" {
			t.Errorf("%s without CSRF token: status=%d code=%q", name, res.Code, errorCode(res))
		}
		if res := send(app, op, miaToken, "wrong-"+miaCSRF, ""); res.Code != http.StatusForbidden || errorCode(res) != "csrf" {
			t.Errorf("%s with wrong CSRF token: status=%d code=%q", name, res.Code, errorCode(res))
		}
		if op.path == "/auth/logout" {
			continue // a successful cross-origin logout would end Mia's session for later cases
		}
		if res := send(app, op, miaToken, miaCSRF, "https://attacker.example"); res.Code != http.StatusForbidden {
			t.Errorf("%s from foreign origin: status=%d", name, res.Code)
		}
	}
}

// Editorial and administrative operations reject lower roles, while the same
// request passes authorization for an admin (proving the rejection is a role check).
func TestRestrictedOperationsRejectLowerRoles(t *testing.T) {
	app, _ := timelineApp(t)
	editorial := []contractOperation{
		{http.MethodPost, "/api/v1/categories"},
		{http.MethodPatch, "/api/v1/categories/{id}"}, // granted managers may edit repeatable categories too
		{http.MethodPost, "/api/v1/categories/{id}/status"},
		{http.MethodGet, "/api/v1/categories/{id}/results"},
		{http.MethodGet, "/api/v1/categories/{id}/export"},
	}
	adminOnly := []contractOperation{
		{http.MethodGet, "/api/v1/categories/{id}/audit"},
		{http.MethodGet, "/api/v1/admin/users"},
		{http.MethodPatch, "/api/v1/admin/users/{id}"},
		{http.MethodGet, "/api/v1/admin/audit"},
		{http.MethodGet, "/api/v1/admin/status"},
	}
	documented := map[contractOperation]bool{}
	for _, op := range contractOperations(t) {
		documented[op] = true
	}
	sessions := map[string][2]string{}
	for _, id := range []string{MiaID, GuestID, ManagerID, AdminID} {
		token, csrf := sessionFor(t, app, id)
		sessions[id] = [2]string{token, csrf}
	}
	checkOnPath := func(contractOp, requestOp contractOperation, denied ...string) {
		documentedOp := contractOperation{contractOp.method, concretePath(contractOp.path)}
		if !documented[documentedOp] {
			t.Errorf("%s %s is not in docs/openapi.json", documentedOp.method, documentedOp.path)
		}
		for _, id := range denied {
			if res := send(app, requestOp, sessions[id][0], sessions[id][1], ""); res.Code != http.StatusForbidden && res.Code != http.StatusNotFound {
				t.Errorf("%s %s as %s: status=%d, want 403/404", requestOp.method, requestOp.path, id, res.Code)
			}
		}
		if res := send(app, requestOp, sessions[AdminID][0], sessions[AdminID][1], ""); res.Code == http.StatusUnauthorized || res.Code == http.StatusForbidden {
			t.Errorf("%s %s as admin: status=%d, the request never reached authorization", requestOp.method, requestOp.path, res.Code)
		}
	}
	check := func(op contractOperation, denied ...string) {
		requestOp := op
		requestOp.path = concretePath(requestOp.path)
		checkOnPath(op, requestOp, denied...)
	}
	for _, op := range editorial {
		check(op, MiaID, GuestID)
	}
	for _, op := range adminOnly {
		check(op, MiaID, GuestID, ManagerID)
	}

	// A manager can edit an assigned repeatable category, but the same route
	// rejects them when the repeatable category is unassigned.
	patchTemplate := contractOperation{http.MethodPatch, "/api/v1/categories/{id}"}
	assignedPatch := contractOperation{http.MethodPatch, "/api/v1/categories/" + categoryID(1)}
	assignedBody := `{"name":"Ideen","description":"Vorschläge für unsere Abizeitung","kind":"idea","version":1,"options":[]}`
	if res := sendBody(app, assignedPatch, sessions[ManagerID][0], sessions[ManagerID][1], "", assignedBody); res.Code != http.StatusOK {
		t.Errorf("manager could not edit assigned repeatable category: status=%d body=%s", res.Code, res.Body)
	}
	unassignedPatch := contractOperation{http.MethodPatch, "/api/v1/categories/" + categoryID(2)}
	checkOnPath(patchTemplate, unassignedPatch, MiaID, GuestID, ManagerID)

	// POST /categories is manager-authorized for every supported category kind.
	managerCreateBodies := []string{
		`{"name":"Manager idea","description":"","kind":"idea","options":[]}`,
		`{"name":"Manager quote","description":"","kind":"quote","options":[]}`,
		`{"name":"Manager memory","description":"","kind":"memory","options":[]}`,
		`{"name":"Manager photo","description":"","kind":"photo","options":[]}`,
		`{"name":"Manager person","description":"","kind":"person","all_people":false,"max_choices":2,"options":[{"label":"Mia","user_id":"` + MiaID + `"},{"label":"Leon","user_id":"` + LeonID + `"}]}`,
		`{"name":"Manager proposal","description":"","kind":"proposal","options":[{"label":"A"},{"label":"B"}]}`,
	}
	createOp := contractOperation{http.MethodPost, "/api/v1/categories"}
	for _, body := range managerCreateBodies {
		if res := sendBody(app, createOp, sessions[ManagerID][0], sessions[ManagerID][1], "", body); res.Code != http.StatusCreated {
			t.Errorf("manager create category: status=%d body=%s", res.Code, res.Body)
		}
	}
}

// Students only ever list and read their own contributions.
func TestStudentsNeverSeeOtherStudentsSubmissions(t *testing.T) {
	app, pool := timelineApp(t)
	for _, student := range []string{MiaID, LeonID, GuestID} {
		res := authenticatedRequest(t, app, pool, student, http.MethodGet, "/api/v1/submissions", "")
		if res.Code != http.StatusOK {
			t.Fatalf("list as %s: status=%d", student, res.Code)
		}
		var listed []Submission
		if err := json.Unmarshal(res.Body.Bytes(), &listed); err != nil {
			t.Fatal(err)
		}
		for _, s := range listed {
			if s.AuthorID != student {
				t.Errorf("%s listed submission %s by %s", student, s.ID, s.AuthorID)
			}
		}
		rows, err := pool.Query(context.Background(), "SELECT id::text FROM submissions WHERE author_id<>$1", student)
		if err != nil {
			t.Fatal(err)
		}
		var foreign []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			foreign = append(foreign, id)
		}
		rows.Close()
		if len(foreign) == 0 {
			t.Fatal("fixture has no foreign submissions to probe")
		}
		for _, id := range foreign {
			for _, suffix := range []string{"", "/revisions", "/corrections"} {
				if res := authenticatedRequest(t, app, pool, student, http.MethodGet, "/api/v1/submissions/"+id+suffix, ""); res.Code != http.StatusNotFound {
					t.Errorf("%s read foreign submission %s%s: status=%d", student, id, suffix, res.Code)
				}
			}
		}
	}
}
