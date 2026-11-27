package authmock

import (
	"net/http/httptest"
	"testing"
)

func testProvider(t *testing.T) (*provider, *httptest.Server, Config) {
	t.Helper()
	server := httptest.NewUnstartedServer(nil)
	config := Config{Environment: "development", Issuer: "http://" + server.Listener.Addr().String(), ClientID: "portal-dev", ClientSecret: "dev-only", RedirectURIs: []string{"http://localhost:8080/auth/callback"}, Users: []User{{Subject: SubjectForSlug("mia_weber"), Name: "Mia Weber", DisplaySlug: "mia_weber"}, {Subject: SubjectForSlug("leon_fischer"), Name: "Leon Fischer", DisplaySlug: "leon_fischer"}}}
	handler, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = handler
	server.Start()
	t.Cleanup(server.Close)
	return handler.(*provider), server, config
}

func TestProviderDevelopmentIsolation(t *testing.T) {
	_, _, config := testProvider(t)
	for _, environment := range []string{"", "production", "test", "Development"} {
		config.Environment = environment
		if _, err := New(config); err == nil {
			t.Fatalf("provider started in %q", environment)
		}
	}
}
