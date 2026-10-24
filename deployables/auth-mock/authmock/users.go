package authmock

import (
	"bytes"
	"crypto/sha1"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"

	"go.yaml.in/yaml/v3"
)

// User contains identity data only. Portal permissions remain in its database.
type User struct {
	// Subject is derived from DisplaySlug by LoadUsers and never read from YAML.
	Subject     string `yaml:"-"`
	Name        string `yaml:"name"`
	DisplaySlug string `yaml:"display_slug"`
}

// subjectNamespace is the fixed UUIDv5 namespace for mock identities.
var subjectNamespace = [16]byte{0x6b, 0x1d, 0x3c, 0x0a, 0x7e, 0x42, 0x4f, 0x8b, 0x9a, 0x51, 0xc3, 0x2d, 0x84, 0xe7, 0x10, 0xaf}

var slugPattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

// SubjectForSlug returns the stable RFC 4122 UUIDv5 (SHA-1) of slug within subjectNamespace.
func SubjectForSlug(slug string) string {
	h := sha1.New()
	h.Write(subjectNamespace[:])
	h.Write([]byte(slug))
	b := h.Sum(nil)[:16]
	b[6] = b[6]&0x0f | 0x50
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
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
	for i := range document.Users {
		document.Users[i].Subject = SubjectForSlug(document.Users[i].DisplaySlug)
	}
	return document.Users, nil
}

func validateUsers(users []User) error {
	if len(users) == 0 || len(users) > 1000 {
		return errors.New("configure between 1 and 1000 identities")
	}
	seen := make(map[string]bool, len(users))
	for _, user := range users {
		if !slugPattern.MatchString(user.DisplaySlug) || !validText(user.Name, 255) || seen[user.DisplaySlug] {
			return errors.New("identities require unique display_slug ([a-z0-9_], 1-64) and nonempty names without control characters")
		}
		seen[user.DisplaySlug] = true
	}
	return nil
}

func validText(s string, max int) bool {
	return strings.TrimSpace(s) != "" && len(s) <= max && strings.IndexFunc(s, unicode.IsControl) < 0
}
