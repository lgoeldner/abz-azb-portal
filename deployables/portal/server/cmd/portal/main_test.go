package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestWaitForDatabaseReturnsOnImmediateSuccess(t *testing.T) {
	calls := 0
	err := waitForDatabase(context.Background(), func(context.Context) error {
		calls++
		return nil
	}, time.Second, 100*time.Millisecond, time.Millisecond)

	if err != nil {
		t.Fatalf("waitForDatabase() error = %v", err)
	}
	if calls != 1 {
		t.Fatalf("ping called %d times; want 1", calls)
	}
}

func TestWaitForDatabaseRecoversFromTransientFailures(t *testing.T) {
	calls := 0
	err := waitForDatabase(context.Background(), func(context.Context) error {
		calls++
		if calls < 3 {
			return errors.New("connection failed: password=must-not-be-returned")
		}
		return nil
	}, time.Second, 100*time.Millisecond, time.Millisecond)

	if err != nil {
		t.Fatalf("waitForDatabase() error = %v", err)
	}
	if calls != 3 {
		t.Fatalf("ping called %d times; want 3", calls)
	}
}

func TestWaitForDatabaseHasFiniteDeadlineAndPingTimeout(t *testing.T) {
	const pingTimeout = 5 * time.Millisecond
	calls := 0
	start := time.Now()
	err := waitForDatabase(context.Background(), func(ctx context.Context) error {
		calls++
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("ping context has no deadline")
		}
		if remaining := time.Until(deadline); remaining > pingTimeout {
			t.Fatalf("ping deadline is %v away; want at most %v", remaining, pingTimeout)
		}
		<-ctx.Done()
		return errors.New("connection failed: password=must-not-be-returned")
	}, 35*time.Millisecond, pingTimeout, time.Millisecond)

	if err == nil || err.Error() != "database readiness timed out" {
		t.Fatalf("waitForDatabase() error = %v; want generic readiness timeout", err)
	}
	if strings.Contains(err.Error(), "password") {
		t.Fatalf("timeout exposed ping error: %v", err)
	}
	if calls == 0 {
		t.Fatal("ping was not attempted")
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("waitForDatabase() took %v for a 35ms deadline", elapsed)
	}
}

func TestWaitForDatabaseHonorsCancellationDuringPing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pingStarted := make(chan struct{})
	go func() {
		<-pingStarted
		cancel()
	}()

	start := time.Now()
	err := waitForDatabase(ctx, func(pingCtx context.Context) error {
		close(pingStarted)
		<-pingCtx.Done()
		return errors.New("connection failed: password=must-not-be-returned")
	}, time.Hour, time.Second, time.Millisecond)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("waitForDatabase() error = %v; want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("waitForDatabase() took %v to honor cancellation", elapsed)
	}
}

func TestWaitForDatabaseHonorsCancellationDuringRetryDelay(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pingFailed := make(chan struct{})
	go func() {
		<-pingFailed
		cancel()
	}()

	calls := 0
	start := time.Now()
	err := waitForDatabase(ctx, func(context.Context) error {
		calls++
		close(pingFailed)
		return errors.New("connection failed: password=must-not-be-returned")
	}, time.Hour, time.Second, time.Second)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("waitForDatabase() error = %v; want context.Canceled", err)
	}
	if calls != 1 {
		t.Fatalf("ping called %d times; want 1", calls)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("waitForDatabase() took %v to honor cancellation during retry delay", elapsed)
	}
}
