// Command openapi prints the generated OpenAPI document (docs/openapi.json) to stdout.
package main

import (
	"fmt"
	"os"

	"abizeitbetrug/server/internal/portal"
)

func main() {
	b, e := portal.OpenAPI()
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	if _, e := os.Stdout.Write(b); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
