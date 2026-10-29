package portal

import (
	"strings"
	"testing"
)

func TestCloudRunConfiguration(t *testing.T) {
	for _, key := range []string{"ADDR", "PORT", "K_SERVICE", "UPLOAD_BUCKET", "FIREBASE_HOSTING", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_BACKCHANNEL_URL"} {
		t.Setenv(key, "")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("AUTH_MODE", "mock")
	t.Setenv("DATABASE_URL", "unused")
	t.Setenv("PORT", "9099")
	cfg, err := LoadConfig()
	if err != nil || cfg.Addr != ":9099" {
		t.Fatalf("PORT was not honored: %q %v", cfg.Addr, err)
	}
	t.Setenv("ADDR", "127.0.0.1:8181")
	cfg, err = LoadConfig()
	if err != nil || cfg.Addr != "127.0.0.1:8181" {
		t.Fatalf("explicit ADDR lost: %q %v", cfg.Addr, err)
	}
	t.Setenv("K_SERVICE", "portal")
	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "durable") {
		t.Fatal("Cloud Run accepted ephemeral uploads")
	}
	t.Setenv("UPLOAD_BUCKET", "private-eu-uploads")
	t.Setenv("FIREBASE_HOSTING", "1")
	cfg, err = LoadConfig()
	if err != nil || !cfg.FirebaseHosting || cfg.UploadBucket != "private-eu-uploads" {
		t.Fatalf("Firebase settings lost: %v", err)
	}
	for _, invalid := range []string{"true", "yes", "01"} {
		t.Setenv("FIREBASE_HOSTING", invalid)
		if _, err := LoadConfig(); err == nil {
			t.Fatalf("invalid hosting mode accepted: %s", invalid)
		}
	}
	t.Setenv("FIREBASE_HOSTING", "0")
	for _, invalid := range []string{"gs://private-bucket", "bucket/path", "bucket\nname"} {
		t.Setenv("UPLOAD_BUCKET", invalid)
		if _, err := LoadConfig(); err == nil {
			t.Fatal("invalid bucket accepted")
		}
	}
}
