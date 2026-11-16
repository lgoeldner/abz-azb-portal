package portal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strings"

	"github.com/swaggest/jsonschema-go"
)

// opDoc is the OpenAPI description of one route. Bodies are Go values whose types are reflected into schemas.
type opDoc struct {
	Summary string
	Req     any    // JSON request body
	Form    any    // multipart/form-data request body
	Res     any    // JSON response body
	Status  int    // success status, default 200
	File    string // non-JSON response content type; the body is described as a string
	Query   any    // struct whose `query` tags name optional query parameters
}

type apiRoute struct {
	Pattern string
	Handler endpoint
	Doc     opDoc
}

// OpenAPI renders docs/openapi.json from apiRoutes and the reflected request and response types.
// It needs no configuration or database: handlers are method values that are never called.
func OpenAPI() ([]byte, error) {
	defs := map[string]jsonschema.Schema{}
	reflector := jsonschema.Reflector{}
	opts := []func(*jsonschema.ReflectContext){
		jsonschema.DefinitionsPrefix("#/components/schemas/"),
		jsonschema.StripDefinitionNamePrefix("Portal"),
		jsonschema.CollectDefinitions(func(name string, s jsonschema.Schema) { defs[name] = s }),
		func(rc *jsonschema.ReflectContext) { rc.EnvelopNullability = true },
		// Every field is required unless it is omitempty or tagged required:"false".
		jsonschema.InterceptProp(func(p jsonschema.InterceptPropParams) error {
			if p.Processed && !strings.Contains(p.Field.Tag.Get("json"), ",omitempty") && p.Field.Tag.Get("required") != "false" {
				p.ParentSchema.Required = append(p.ParentSchema.Required, p.Name)
			}
			return nil
		}),
		jsonschema.InterceptSchema(func(p jsonschema.InterceptSchemaParams) (bool, error) {
			if p.Processed && p.Schema.HasType(jsonschema.Object) && len(p.Schema.Properties) > 0 {
				no := false
				p.Schema.AdditionalProperties = &jsonschema.SchemaOrBool{TypeBoolean: &no}
			}
			return false, nil
		}),
	}
	schemaOf := func(v any, extra ...func(*jsonschema.ReflectContext)) (map[string]any, error) {
		s, e := reflector.Reflect(v, append(append([]func(*jsonschema.ReflectContext){}, opts...), extra...)...)
		if e != nil {
			return nil, e
		}
		return toMap(s)
	}
	ref := func(v any) (map[string]any, error) { return schemaOf(v, jsonschema.RootRef) }

	paths := orderedMap{} // registration order keeps the document diff-friendly
	ids := map[string]string{}
	for _, rt := range (&App{}).apiRoutes() {
		method, path, _ := strings.Cut(rt.Pattern, " ")
		d := rt.Doc
		id := operationID(method, path)
		if prev, dup := ids[id]; dup {
			return nil, fmt.Errorf("operationId %s used by %s and %s", id, prev, rt.Pattern)
		}
		ids[id] = rt.Pattern
		op := map[string]any{"operationId": id, "summary": d.Summary}
		params := []any{}
		for _, m := range pathParam.FindAllStringSubmatch(path, -1) {
			params = append(params, map[string]any{"name": m[1], "in": "path", "required": true, "schema": map[string]any{"type": "string"}})
		}
		if d.Query != nil {
			q, e := schemaOf(d.Query, jsonschema.PropertyNameTag("query"))
			if e != nil {
				return nil, e
			}
			props, _ := q["properties"].(map[string]any)
			names := make([]string, 0, len(props))
			for n := range props {
				names = append(names, n)
			}
			sort.Strings(names)
			for _, n := range names {
				params = append(params, map[string]any{"name": n, "in": "query", "schema": props[n]})
			}
		}
		if method != http.MethodGet {
			params = append(params, map[string]any{"name": "X-CSRF-Token", "in": "header", "required": true, "schema": map[string]any{"type": "string"}})
		}
		if len(params) > 0 {
			op["parameters"] = params
		}
		if d.Req != nil || d.Form != nil {
			content := map[string]any{}
			for ctype, body := range map[string]any{"application/json": d.Req, "multipart/form-data": d.Form} {
				if body == nil {
					continue
				}
				s, e := ref(body)
				if e != nil {
					return nil, e
				}
				content[ctype] = map[string]any{"schema": s}
			}
			op["requestBody"] = map[string]any{"required": true, "content": content}
		}
		status := d.Status
		if status == 0 {
			status = http.StatusOK
		}
		success := map[string]any{"description": "Success"}
		switch {
		case d.File != "":
			schema := map[string]any{"type": "string", "format": "binary"}
			if strings.HasPrefix(d.File, "text/") {
				schema = map[string]any{"type": "string"}
			}
			success["content"] = map[string]any{d.File: map[string]any{"schema": schema}}
		case d.Res != nil:
			s, e := schemaOf(d.Res, jsonschema.RootRef)
			if e != nil {
				return nil, e
			}
			success["content"] = map[string]any{"application/json": map[string]any{"schema": s}}
		default:
			success["description"] = "No content"
		}
		errSchema, e := ref(Error{})
		if e != nil {
			return nil, e
		}
		op["responses"] = map[string]any{
			fmt.Sprint(status): success,
			"default":          map[string]any{"description": "Error", "content": map[string]any{"application/json": map[string]any{"schema": errSchema}}},
		}
		item, _ := paths.get(path).(*orderedMap)
		if item == nil {
			item = &orderedMap{}
			paths.set(path, item)
		}
		item.set(strings.ToLower(method), op)
	}
	schemas := map[string]any{}
	for name, s := range defs {
		m, e := toMap(s)
		if e != nil {
			return nil, e
		}
		schemas[name] = m
	}
	doc := map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "AbiZeitBetrug Portal API",
			"version":     "1.0.0",
			"description": "Private LMGU 2027 portal. Better Auth cookie sessions are validated by the private auth service; Go enforces current local permissions and CSRF. Explicit legacy OIDC deployments remain supported. Auth-provider and private service endpoints are outside this API.",
		},
		"security": []any{map[string]any{"session": []any{}}},
		"paths":    &paths,
		"components": map[string]any{
			"securitySchemes": map[string]any{"session": map[string]any{"type": "apiKey", "in": "cookie", "name": "portal_session"}},
			"schemas":         schemas,
		},
	}
	tidySchemas(doc)
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if e := enc.Encode(doc); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}

var pathParam = regexp.MustCompile(`\{([^}]+)\}`)
var nonAlnum = regexp.MustCompile(`[^A-Za-z0-9]+`)

// operationID is the lower-case method followed by the capitalised path segments after /api/v1.
func operationID(method, path string) string {
	id := strings.ToLower(method)
	for _, seg := range strings.Split(strings.TrimPrefix(path, "/api/v1/"), "/") {
		for _, w := range nonAlnum.Split(seg, -1) {
			if w != "" {
				id += strings.ToUpper(w[:1]) + w[1:]
			}
		}
	}
	return id
}

// orderedMap is a JSON object that keeps insertion order.
type orderedMap struct {
	keys []string
	vals map[string]any
}

func (o *orderedMap) get(k string) any { return o.vals[k] }

func (o *orderedMap) set(k string, v any) {
	if o.vals == nil {
		o.vals = map[string]any{}
	}
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
}

func (o *orderedMap) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		var vb bytes.Buffer
		enc := json.NewEncoder(&vb)
		enc.SetEscapeHTML(false)
		if e := enc.Encode(o.vals[k]); e != nil {
			return nil, e
		}
		b.Write(bytes.TrimSpace(vb.Bytes()))
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func toMap(v any) (map[string]any, error) {
	b, e := json.Marshal(v)
	if e != nil {
		return nil, e
	}
	var m map[string]any
	return m, json.Unmarshal(b, &m)
}

// tidySchemas fixes reflector output: it adds null to every slice (handlers always send []), and it leaves a
// stray type next to $ref and next to nullable anyOf, which would forbid null.
func tidySchemas(v any) {
	switch t := v.(type) {
	case map[string]any:
		if ty, ok := t["type"].([]any); ok && len(ty) == 2 && reflect.DeepEqual(ty, []any{"array", "null"}) {
			t["type"] = "array"
		}
		if _, ok := t["$ref"]; ok {
			delete(t, "type")
		}
		if alt, ok := t["anyOf"].([]any); ok && len(alt) == 2 {
			if first, _ := alt[0].(map[string]any); first["type"] == "null" {
				alt[0], alt[1] = alt[1], alt[0]
				delete(t, "type")
			}
		}
		for _, c := range t {
			tidySchemas(c)
		}
	case []any:
		for _, c := range t {
			tidySchemas(c)
		}
	}
}
