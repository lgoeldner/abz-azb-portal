package portal

import (
	"os"
	"regexp"
	"testing"
)

// Routes registered outside apiRoutes would be undocumented.
func TestNoAPIRouteBypassesTheTable(t *testing.T) {
	src, err := os.ReadFile("http.go")
	if err != nil {
		t.Fatal(err)
	}
	if m := regexp.MustCompile(`(?:api|m)\.Handle(?:Func)?\("[A-Z]+ /api/`).Find(src); m != nil {
		t.Fatalf("register API routes in apiRoutes, not with %s", m)
	}
}

// docs/openapi.json is generated; this fails when someone edits a route or type without regenerating it.
func TestOpenAPIDocumentIsCurrent(t *testing.T) {
	got, err := OpenAPI()
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("../../../../../docs/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatal("docs/openapi.json is stale; run node scripts/check-contract.mjs --write")
	}
}

func TestEveryAPIRouteHasAHandlerAndSummary(t *testing.T) {
	for _, r := range (&App{}).apiRoutes() {
		if r.Handler == nil || r.Doc.Summary == "" {
			t.Errorf("%s needs a handler and a summary", r.Pattern)
		}
	}
}
