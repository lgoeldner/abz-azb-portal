package portal

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRosterParsingRejectsConflictsAndImplicitPrivilege(t *testing.T) {
	if _, err := parseRoster(strings.NewReader("email,name\n"+strings.Repeat(" ", 10<<20)), false); err == nil {
		t.Fatal("oversized roster was silently truncated")
	}
	for _, input := range []string{
		"email,name,role\na@example.test,A,admin\n",
		"email,name\na@example.test,A\nA@example.test,B\n",
		"email,name,login_enabled\na@example.test,A,yes\n",
		"email,name\nA <a@example.test>,A\n",
	} {
		if _, err := parseRoster(strings.NewReader(input), false); err == nil {
			t.Fatal("unsafe roster accepted")
		}
	}
	rows, err := parseRoster(strings.NewReader("email,name\n A@example.test , A \n"), false)
	if err != nil || len(rows) != 1 || rows[0].Email != "a@example.test" || rows[0].Role != nil {
		t.Fatalf("parse: %v", err)
	}
}
func TestProvisioningStableIDsRollbackAndCredentialInvalidation(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "roster.csv")
	data := "id,email,name,admitted,cohort_member,login_enabled\n" + MiaID + ",mia-new@example.test,Mia,true,true,true\n"
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := RunUserCommand(ctx, pool, []string{"import", "--file", path, "--dry-run"}, &output); err != nil {
		t.Fatal(err)
	}
	var email string
	if err := pool.QueryRow(ctx, "SELECT login_email FROM users WHERE id=$1", MiaID).Scan(&email); err != nil || email == "mia-new@example.test" {
		t.Fatal("dry run changed data")
	}
	for i := 0; i < 2; i++ {
		if err := RunUserCommand(ctx, pool, []string{"import", "--file", path, "--apply"}, &output); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1 AND login_email='mia-new@example.test'", MiaID).Scan(&count); err != nil || count != 1 {
		t.Fatal("import changed or duplicated UUID")
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM submissions WHERE author_id=$1", MiaID).Scan(&count); err != nil || count != 2 {
		t.Fatal("import lost contributions")
	}
	_, err := pool.Exec(ctx, "INSERT INTO auth_sessions(id,user_id,token,expires_at) VALUES($1,$2,'synthetic',now()+interval '1 hour');", ID(), MiaID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO auth_verifications(id,identifier,value,expires_at) VALUES($1,'synthetic',$2,now()+interval '15 minutes')`, ID(), `{"type":"magic-link","email":"mia-new@example.test"}`)
	if err != nil {
		t.Fatal(err)
	}
	if err = RunUserCommand(ctx, pool, []string{"set-email", "--id", MiaID, "--email", "another@example.test", "--apply"}, &output); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM auth_sessions WHERE user_id=$1)+(SELECT count(*) FROM auth_verifications)", MiaID).Scan(&count); err != nil || count != 0 {
		t.Fatal("email change left usable credentials")
	}
	if _, err = pool.Exec(ctx, "SELECT portal_set_user_email($1,'mia-new@example.test')", LeonID); err == nil {
		t.Fatal("old link address reassigned before expiry")
	}
	if err = RunUserCommand(ctx, pool, []string{"disable", "--id", AdminID, "--apply"}, &output); err == nil {
		t.Fatal("last administrator disabled")
	}
}
