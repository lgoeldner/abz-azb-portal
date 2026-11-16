package portal

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEraseUserInvariants(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	uploads := t.TempDir()
	cfg := Config{UploadDir: uploads}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	// One contribution with an image each for Mia (erased) and Leon (kept).
	files := map[string]string{MiaID: "mia", LeonID: "leon"}
	for id, prefix := range files {
		sub := "00000000-0000-4000-8000-00000000e" + map[string]string{MiaID: "001", LeonID: "002"}[id]
		exec("INSERT INTO submissions(id,category_id,author_id,title,body,context,idempotency_key,request_hash) VALUES($1,$2,$3,'t','b','c',$4,'h')", sub, categoryID(1), id, "erase-"+sub)
		exec("INSERT INTO attachments(id,submission_id,filename,mime_type,size_bytes,sha256,storage_key,preview_key) VALUES($1,$2,'f.jpg','image/jpeg',1,'x',$3,$4)", strings.Replace(sub, "e", "a", 1), sub, prefix+"-original", prefix+"-preview")
		for _, key := range []string{prefix + "-original", prefix + "-preview"} {
			if err := os.WriteFile(filepath.Join(uploads, key), []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	mia, leon := "40000000-0000-4000-8000-000000000201", "40000000-0000-4000-8000-000000000202"
	exec("INSERT INTO ballots(poll_id,user_id,option_id) VALUES($1,$2,$3),($1,$4,$5)", pollID(2), LeonID, mia, MiaID, leon)
	exec("INSERT INTO ballot_audit(id,poll_id,user_id,option_id) VALUES(gen_random_uuid(),$1,$2,$3),(gen_random_uuid(),$1,$4,$5)", pollID(2), LeonID, mia, MiaID, leon)
	exec("INSERT INTO ticket_events(ticket_id,actor_id,kind,detail) SELECT id,$1,'assign','Sam (Redaktion) -> Mia Weber' FROM tickets LIMIT 1", ManagerID)
	exec("INSERT INTO mail_messages(id,user_id,kind,status) VALUES('00000000-0000-4000-8000-00000000e100',$1,'login','delivered')", MiaID)
	exec("INSERT INTO mail_destinations(message_id,recipient_snapshot) VALUES('00000000-0000-4000-8000-00000000e100','mia_weber@example.test')")
	exec("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES('erase-test',$1,'c',now()+interval '1 hour')", MiaID)

	run := func(args ...string) (string, error) {
		var out bytes.Buffer
		err := RunEraseCommand(ctx, pool, cfg, args, &out)
		return out.String(), err
	}
	exists := func(key string) bool { _, err := os.Stat(filepath.Join(uploads, key)); return err == nil }

	// A dry run reports but changes nothing and keeps the files.
	ownBefore := count("SELECT count(*) FROM submissions WHERE author_id=$1", MiaID)
	if out, err := run("--id", MiaID); err != nil || !strings.Contains(out, `"applied":false`) {
		t.Fatalf("dry run: %v %s", err, out)
	}
	if count("SELECT count(*) FROM submissions WHERE author_id=$1", MiaID) != ownBefore || !exists("mia-original") || count("SELECT count(*) FROM users WHERE id=$1 AND erased_at IS NULL", MiaID) != 1 {
		t.Fatal("dry run changed data")
	}

	// The last usable administrator cannot be erased.
	if _, err := run("--id", AdminID, "--apply"); err == nil || count("SELECT count(*) FROM users WHERE id=$1 AND erased_at IS NULL AND role='admin'", AdminID) != 1 {
		t.Fatalf("last admin erase: %v", err)
	}

	if out, err := run("--id", MiaID, "--apply"); err != nil || !strings.Contains(out, `"applied":true`) {
		t.Fatalf("erase: %v %s", err, out)
	}
	checks := []struct {
		what string
		sql  string
		want int
	}{
		{"identity", "SELECT count(*) FROM users WHERE id=$1 AND name='Gelöschte Person' AND login_email IS NULL AND subject IS NULL AND NOT admitted AND NOT login_enabled AND NOT cohort_member AND erased_at IS NOT NULL", 1},
		{"own contributions", "SELECT count(*) FROM submissions WHERE author_id=$1", 0},
		{"own votes", "SELECT count(*) FROM ballots WHERE user_id=$1", 0},
		{"own vote history", "SELECT count(*) FROM ballot_audit WHERE user_id=$1", 0},
		{"options about the person", "SELECT count(*) FROM poll_options WHERE user_id=$1", 0},
		{"stored addresses", "SELECT count(*) FROM mail_destinations WHERE recipient_snapshot LIKE 'mia_weber%' AND $1::uuid IS NOT NULL", 0},
		{"quarantined address", "SELECT count(*) FROM retired_login_emails WHERE user_id=$1", 0},
		{"sessions", "SELECT count(*) FROM sessions WHERE user_id=$1", 0},
		{"consent", "SELECT count(*) FROM consents WHERE user_id=$1", 0},
		{"name in ticket history", "SELECT count(*) FROM ticket_events WHERE detail LIKE '%Mia Weber%' AND $1::uuid IS NOT NULL", 0},
		{"operator audit", "SELECT count(*) FROM user_operator_audit WHERE user_id=$1 AND action='user.erased'", 1},
	}
	for _, c := range checks {
		if got := count(c.sql, MiaID); got != c.want {
			t.Errorf("%s: got %d want %d", c.what, got, c.want)
		}
	}
	// Other people's votes for the erased person go; their other data stays.
	if count("SELECT count(*) FROM ballots WHERE option_id=$1", mia) != 0 {
		t.Error("votes for the erased person remain")
	}
	if count("SELECT count(*) FROM submissions WHERE id='00000000-0000-4000-8000-00000000e002'") != 1 || count("SELECT count(*) FROM poll_options WHERE id=$1", leon) != 1 {
		t.Error("other people's data was removed")
	}
	if exists("mia-original") || exists("mia-preview") || !exists("leon-original") || !exists("leon-preview") {
		t.Error("wrong upload files removed")
	}
	if count("SELECT count(*) FROM ticket_events WHERE detail='Sam (Redaktion) -> Gelöschte Person'") != 1 {
		t.Error("ticket history lost its anonymised entry")
	}
	// The tombstone cannot be revived, listed or erased twice.
	if _, err := pool.Exec(ctx, "SELECT portal_provision_user($1::uuid,'mia@example.test','Mia')", MiaID); err == nil {
		t.Error("import re-attached an identity to an erased user")
	}
	if _, err := run("--id", MiaID, "--apply"); err == nil {
		t.Error("second erase succeeded")
	}
	// A request that was already running cannot add new data for the erased person.
	if _, err := pool.Exec(ctx, "INSERT INTO submissions(id,category_id,author_id,title,body,context,idempotency_key,request_hash) VALUES('00000000-0000-4000-8000-00000000e003',$1,$2,'t','b','c','late-write','h')", categoryID(1), MiaID); err == nil {
		t.Error("late contribution for erased user was stored")
	}
	if _, err := pool.Exec(ctx, "INSERT INTO ballots(poll_id,user_id,option_id) VALUES($1,$2,$3)", pollID(2), MiaID, leon); err == nil {
		t.Error("late vote for erased user was stored")
	}
}
