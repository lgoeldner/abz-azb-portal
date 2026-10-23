package portal

import (
	"os"
	"testing"

	"abizeitbetrug/server/internal/authmock"
)

// Seeded accounts must be reachable by logging in as the matching mock identity.
func TestSeededAccountsMatchAuthMockUsers(t *testing.T) {
	file, err := os.Open("../../../deployables/auth-mock/users.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	users, err := authmock.LoadUsers(file)
	if err != nil {
		t.Fatal(err)
	}
	issued := map[string]bool{}
	for _, u := range users {
		issued[u.Subject] = true
	}
	for _, id := range []string{AdminID, ManagerID, MiaID, LeonID, GuestID, PendingID} {
		if !issued[FixtureSubject(id)] {
			t.Fatalf("seeded account %s has no auth-mock identity", id)
		}
	}
}
