package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"abizeitbetrug/server/internal/authmock"
)

func handlerFromEnvironment() (http.Handler, error) {
	if os.Getenv("APP_ENV") != "development" {
		return nil, errors.New("auth-mock requires APP_ENV=development")
	}
	file, err := os.Open(env("AUTH_MOCK_USERS", "/config/users.yaml"))
	if err != nil {
		return nil, errors.New("cannot open auth-mock identity configuration")
	}
	defer file.Close()
	users, err := authmock.LoadUsers(file)
	if err != nil {
		return nil, err
	}
	redirects := strings.Split(env("AUTH_MOCK_REDIRECT_URIS", "http://localhost:5173/auth/callback,http://localhost:8080/auth/callback,http://127.0.0.1:8080/auth/callback"), ",")
	for i := range redirects {
		redirects[i] = strings.TrimSpace(redirects[i])
	}
	return authmock.New(authmock.Config{
		Environment: os.Getenv("APP_ENV"), Issuer: env("OIDC_ISSUER", "http://localhost:9090"),
		ClientID: env("OIDC_CLIENT_ID", "portal-dev"), ClientSecret: env("OIDC_CLIENT_SECRET", "dev-only"),
		RedirectURIs: redirects, Users: users,
	})
}

func main() {
	handler, err := handlerFromEnvironment()
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: env("ADDR", ":9090"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	log.Print("development identity provider listening")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("auth-mock server stopped")
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
