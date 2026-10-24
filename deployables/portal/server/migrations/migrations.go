package migrations

import "embed"

// Files contains the immutable, versioned SQL migrations.
//
//go:embed *.sql
var Files embed.FS
