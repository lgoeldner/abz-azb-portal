package portal

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct{ Env, Addr, DatabaseURL, PublicURL, UploadDir, StaticDir, AuthMode, Issuer, ClientID, ClientSecret, SessionSecret, BootstrapSubject, BackupStatusFile string }

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func LoadConfig() (Config, error) {
	c := Config{Env: env("APP_ENV", "development"), Addr: env("ADDR", ":8080"), DatabaseURL: os.Getenv("DATABASE_URL"), PublicURL: env("PUBLIC_URL", "http://localhost:8080"), UploadDir: env("UPLOAD_DIR", "./data/uploads"), StaticDir: env("STATIC_DIR", "../web/dist"), AuthMode: env("AUTH_MODE", "mock"), Issuer: os.Getenv("OIDC_ISSUER"), ClientID: os.Getenv("OIDC_CLIENT_ID"), ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"), SessionSecret: os.Getenv("SESSION_SECRET"), BootstrapSubject: os.Getenv("BOOTSTRAP_ADMIN_SUBJECT"), BackupStatusFile: os.Getenv("BACKUP_STATUS_FILE")}
	return c, c.Validate()
}
func (c Config) Validate() error {
	if c.Env != "development" && c.Env != "production" {
		return errors.New("APP_ENV must be development or production")
	}
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if c.AuthMode != "mock" && c.AuthMode != "oidc" {
		return errors.New("AUTH_MODE must be mock or oidc")
	}
	u, e := url.Parse(c.PublicURL)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("PUBLIC_URL must be an HTTP(S) origin")
	}
	if c.AuthMode == "oidc" && (c.Issuer == "" || c.ClientID == "" || c.ClientSecret == "") {
		return errors.New("OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required")
	}
	if c.Env == "production" {
		if c.AuthMode != "oidc" {
			return errors.New("mock authentication forbidden in production")
		}
		if u.Scheme != "https" || !strings.HasPrefix(c.Issuer, "https://") {
			return errors.New("production requires HTTPS public URL and OIDC issuer")
		}
		if len(c.SessionSecret) < 32 {
			return errors.New("production SESSION_SECRET must contain at least 32 characters")
		}
		if c.UploadDir == "" || c.StaticDir == "" {
			return errors.New("production storage paths required")
		}
	}
	return nil
}
