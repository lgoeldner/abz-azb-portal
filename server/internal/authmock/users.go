package authmock

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"unicode"

	"go.yaml.in/yaml/v3"
)

// User contains identity data only. Portal permissions remain in its database.
type User struct {
	Subject string `yaml:"subject"`
	Name    string `yaml:"name"`
}

// LoadUsers accepts one strict YAML document with a users sequence.
func LoadUsers(r io.Reader) ([]User, error) {
	data, err := io.ReadAll(io.LimitReader(r, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, errors.New("cannot read identity YAML or size exceeds 1 MiB")
	}
	var document struct {
		Users []User `yaml:"users"`
	}
	d := yaml.NewDecoder(bytes.NewReader(data))
	d.KnownFields(true)
	if err := d.Decode(&document); err != nil {
		return nil, errors.New("invalid identity YAML")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return nil, errors.New("identity YAML must contain exactly one document")
	}
	if err := validateUsers(document.Users); err != nil {
		return nil, err
	}
	return document.Users, nil
}

func validateUsers(users []User) error {
	if len(users) == 0 || len(users) > 1000 {
		return errors.New("configure between 1 and 1000 identities")
	}
	seen := make(map[string]bool, len(users))
	for _, user := range users {
		if !validText(user.Subject, 255) || !validText(user.Name, 255) || seen[user.Subject] {
			return errors.New("identities require unique subjects and nonempty names without control characters")
		}
		seen[user.Subject] = true
	}
	return nil
}

func validText(s string, max int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= max && strings.IndexFunc(s, unicode.IsControl) < 0
}
