package portal

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnvLabelMarksServedIndex(t *testing.T) {
	static := t.TempDir()
	shell := `<!doctype html><html lang="de"><head></head><body><div id="root"></div></body></html>`
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte(shell), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(static, "app.js"), []byte("<html"), 0o600); err != nil {
		t.Fatal(err)
	}
	get := func(label, path string) string {
		app := &App{Config: Config{Env: "development", StaticDir: static, EnvLabel: label}}
		app.routes()
		res := httptest.NewRecorder()
		app.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != http.StatusOK {
			t.Fatalf("%s %s: %d", label, path, res.Code)
		}
		return res.Body.String()
	}
	for _, path := range []string{"/", "/beitraege/neu"} {
		body := get("test", path)
		if !strings.Contains(body, `<html data-env="test" lang="de">`) || strings.Count(body, "data-env") != 1 {
			t.Fatalf("test label missing on %s: %s", path, body)
		}
		for _, label := range []string{"", "prod"} {
			if body := get(label, path); body != shell {
				t.Fatalf("label %q changed the page: %s", label, body)
			}
		}
	}
	if body := get("test", "/app.js"); body != "<html" {
		t.Fatalf("static assets must stay untouched: %s", body)
	}
}

func TestEnvLabelValidation(t *testing.T) {
	cfg := Config{Env: "development", DatabaseURL: "unused", PublicURL: "http://localhost:8080", AuthMode: "better_auth", AuthInternalURL: "http://auth:3000", AuthServiceSecret: strings.Repeat("s", 32)}
	for _, label := range []string{"", "dev", "preview", "test", "prod"} {
		cfg.EnvLabel = label
		if err := cfg.Validate(); err != nil {
			t.Fatalf("%q rejected: %v", label, err)
		}
	}
	for _, label := range []string{"staging", "TEST", "test ", "\"><script>"} {
		cfg.EnvLabel = label
		if cfg.Validate() == nil {
			t.Fatalf("%q accepted", label)
		}
	}
	// The server refuses to start with a label outside the list.
	t.Setenv("APP_ENV", "development")
	t.Setenv("DATABASE_URL", "unused")
	t.Setenv("AUTH_MODE", "mock")
	t.Setenv("AUTH_INTERNAL_URL", "")
	t.Setenv("ENV_LABEL", "test")
	if c, err := LoadConfig(); err != nil || c.EnvLabel != "test" {
		t.Fatalf("ENV_LABEL=test: %q, %v", c.EnvLabel, err)
	}
	t.Setenv("ENV_LABEL", "staging")
	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "ENV_LABEL") {
		t.Fatalf("ENV_LABEL=staging started: %v", err)
	}
}
