package main

import (
	"abizeitbetrug/server/internal/portal"
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		slog.Error("portal stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	c, e := portal.LoadConfig()
	if e != nil {
		return e
	}
	pool, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return e
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		return e
	}
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	switch command {
	case "migrate":
		return portal.Migrate(ctx, pool)
	case "seed":
		return portal.SeedWithIssuer(ctx, pool, c.Env, c.Issuer)
	case "serve":
	default:
		return errors.New("usage: portal [serve|migrate|seed]")
	}
	app, e := portal.New(ctx, c, pool)
	if e != nil {
		return e
	}
	server := &http.Server{Addr: c.Addr, Handler: app, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	done := make(chan error, 1)
	go func() {
		slog.Info("portal listening", "addr", c.Addr, "environment", c.Env)
		done <- server.ListenAndServe()
	}()
	select {
	case e := <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
