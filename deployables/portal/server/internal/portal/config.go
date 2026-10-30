package portal

import (
	"errors"
	"net/netip"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Env               string
	Addr              string
	DatabaseURL       string
	PublicURL         string
	UploadDir         string
	StaticDir         string
	AuthMode          string
	Issuer            string
	BackchannelURL    string
	ClientID          string
	ClientSecret      string
	SessionSecret     string
	BootstrapSubject  string
	BackupStatusFile  string
	AuthInternalURL   string
	AuthServiceSecret string
	TrustedProxyCIDRs string
	Mail              MailConfig
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func LoadConfig() (Config, error) { return LoadConfigForCommand("serve") }

// Maintenance commands require database configuration, never a live identity/mail provider.
func LoadConfigForCommand(command string) (Config, error) {
	c := Config{Env: env("APP_ENV", "development"), Addr: env("ADDR", ":8080"), DatabaseURL: os.Getenv("DATABASE_URL"), PublicURL: env("PUBLIC_URL", "http://localhost:8080"), UploadDir: env("UPLOAD_DIR", "./data/uploads"), StaticDir: env("STATIC_DIR", "../web/dist"), AuthMode: env("AUTH_MODE", "mock"), Issuer: os.Getenv("OIDC_ISSUER"), BackchannelURL: os.Getenv("OIDC_BACKCHANNEL_URL"), ClientID: os.Getenv("OIDC_CLIENT_ID"), ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"), SessionSecret: os.Getenv("SESSION_SECRET"), BootstrapSubject: os.Getenv("BOOTSTRAP_ADMIN_SUBJECT"), BackupStatusFile: os.Getenv("BACKUP_STATUS_FILE"), AuthInternalURL: os.Getenv("AUTH_INTERNAL_URL"), AuthServiceSecret: os.Getenv("AUTH_SERVICE_SECRET"), TrustedProxyCIDRs: os.Getenv("TRUSTED_PROXY_CIDRS")}
	if c.Env == "development" && c.AuthMode == "mock" && c.AuthInternalURL == "" {
		c.Issuer = env("OIDC_ISSUER", "http://localhost:9090")
		c.ClientID = env("OIDC_CLIENT_ID", "portal-dev")
		c.ClientSecret = env("OIDC_CLIENT_SECRET", "dev-only")
	}
	if c.Env != "development" && c.Env != "production" {
		return c, errors.New("APP_ENV must be development or production")
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if command != "serve" && command != "reminders" {
		return c, nil
	}
	var err error
	c.Mail, err = LoadMailConfig(c.Env)
	if err != nil {
		return c, err
	}
	c.Mail.PublicURL = c.PublicURL
	return c, c.Validate()
}
func (c Config) dependencyAuth() bool {
	return c.AuthMode == "better_auth" || c.AuthMode == "mock" && c.AuthInternalURL != ""
}
func originURL(value string) (*url.URL, error) {
	u, e := url.Parse(value)
	if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("expected HTTP(S) origin")
	}
	return u, nil
}
func (c Config) Validate() error {
	if c.Env != "development" && c.Env != "production" {
		return errors.New("APP_ENV must be development or production")
	}
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if c.AuthMode != "mock" && c.AuthMode != "oidc" && c.AuthMode != "better_auth" {
		return errors.New("AUTH_MODE must be mock, oidc or better_auth")
	}
	for _, cidr := range strings.Split(c.TrustedProxyCIDRs, ",") {
		if strings.TrimSpace(cidr) != "" {
			if _, err := netip.ParsePrefix(strings.TrimSpace(cidr)); err != nil {
				return errors.New("TRUSTED_PROXY_CIDRS contains an invalid network")
			}
		}
	}
	u, e := originURL(c.PublicURL)
	if e != nil {
		return errors.New("PUBLIC_URL must be an HTTP(S) origin")
	}
	if c.Env == "production" && c.AuthMode == "mock" {
		return errors.New("mock authentication forbidden in production")
	}
	if c.dependencyAuth() {
		if _, e = originURL(c.AuthInternalURL); e != nil {
			return errors.New("AUTH_INTERNAL_URL must be an HTTP(S) origin")
		}
		if len(c.AuthServiceSecret) < 32 {
			return errors.New("AUTH_SERVICE_SECRET must contain at least 32 characters")
		}
		if c.BackchannelURL != "" {
			return errors.New("OIDC_BACKCHANNEL_URL is not allowed with Better Auth")
		}
		if c.Env == "production" && (c.Mail.Provider != "brevo" || c.Mail.APIKey == "" || !validMailAddress(c.Mail.From)) {
			return errors.New("production Better Auth requires configured Brevo delivery")
		}
	} else {
		if c.Issuer == "" || c.ClientID == "" || c.ClientSecret == "" {
			return errors.New("OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required")
		}
		issuer, err := url.Parse(c.Issuer)
		if err != nil || issuer.Host == "" || issuer.User != nil || (issuer.Scheme != "http" && issuer.Scheme != "https") || issuer.RawQuery != "" || issuer.Fragment != "" {
			return errors.New("OIDC_ISSUER must be an HTTP(S) URL")
		}
		if c.Env == "production" && issuer.Scheme != "https" {
			return errors.New("production requires HTTPS public URL and OIDC issuer")
		}
		if c.BackchannelURL != "" {
			if c.Env != "development" || c.AuthMode != "mock" {
				return errors.New("OIDC_BACKCHANNEL_URL is only allowed in development mock mode")
			}
			if _, err = originURL(c.BackchannelURL); err != nil {
				return errors.New("OIDC_BACKCHANNEL_URL must be an HTTP(S) origin")
			}
		}
	}
	if c.Env == "production" {
		if u.Scheme != "https" {
			return errors.New("production requires HTTPS public URL")
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
