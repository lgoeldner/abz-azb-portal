package main

import "testing"

func TestEnvironmentMustExplicitlyEnableDevelopment(t *testing.T) {
	for _, environment := range []string{"", "production", "test"} {
		t.Setenv("APP_ENV", environment)
		if _, err := handlerFromEnvironment(); err == nil {
			t.Fatalf("auth-mock started in %q", environment)
		}
	}
}
