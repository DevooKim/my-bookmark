package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type internalResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *internalResponse) Header() http.Header { return w.header }
func (w *internalResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *internalResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.body.Write(b)
}
func RegisterMCP(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/mcp", mcpMethodNotAllowed)
	mux.HandleFunc("DELETE /api/mcp", mcpMethodNotAllowed)
	mux.HandleFunc("POST /api/mcp", func(w http.ResponseWriter, r *http.Request) {
		accept := r.Header.Get("Accept")
		if !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
			mcpError(w, nil, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream", 406)
			return
		}
		var req struct {
			JSONRPC string          `json:"jsonrpc"`
			ID      json.RawMessage `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params"`
		}
		if Decode(r, &req) != nil || req.JSONRPC != "2.0" || req.Method == "" {
			mcpError(w, nil, -32700, "Parse error: Invalid JSON-RPC message", 400)
			return
		}
		if len(req.ID) == 0 {
			w.WriteHeader(202)
			return
		}
		result := any(nil)
		switch req.Method {
		case "initialize":
			var p struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			_ = json.Unmarshal(req.Params, &p)
			version := p.ProtocolVersion
			switch version {
			case "2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25":
			default:
				version = "2025-11-25"
			}
			result = map[string]any{"protocolVersion": version, "capabilities": map[string]any{"tools": map[string]any{"listChanged": true}}, "serverInfo": map[string]any{"name": "my-bookmark", "version": "1.0.0"}}
		case "ping":
			result = map[string]any{}
		case "tools/list":
			result = map[string]any{"tools": mcpTools()}
		case "tools/call":
			var p struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if json.Unmarshal(req.Params, &p) != nil {
				mcpError(w, req.ID, -32602, "Invalid params", 200)
				return
			}
			result = callMCPTool(mux, r, p.Name, p.Arguments)
		default:
			mcpError(w, req.ID, -32601, "Method not found", 200)
			return
		}
		JSON(w, 200, map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	})
}
func mcpMethodNotAllowed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Allow", "POST")
	mcpError(w, nil, -32000, "Method not allowed", 405)
}
func mcpError(w http.ResponseWriter, id json.RawMessage, code int, message string, status int) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	JSON(w, status, map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}
func mcpTools() []any {
	const uuidRegex = "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
	const schema = "http://json-schema.org/draft-07/schema#"
	uuid := map[string]any{"type": "string", "format": "uuid", "pattern": uuidRegex}
	execution := map[string]any{"taskSupport": "forbidden"}
	return []any{
		map[string]any{"name": "search_bookmarks", "description": "Search the authenticated user's bookmarks. Use semantic=true for meaning- or topic-based searches (for example, finding bookmarks related to a concept even when the exact words are not present); semantic=true requires q and cannot be combined with categoryId, kind, or cursor. Omit semantic or set it to false for partial-text, category, kind, or cursor filtering.", "execution": execution, "inputSchema": map[string]any{"$schema": schema, "type": "object", "properties": map[string]any{"q": map[string]any{"type": "string", "minLength": 1}, "categoryId": map[string]any{"anyOf": []any{uuid, map[string]any{"const": "none", "type": "string"}}}, "kind": map[string]any{"type": "string", "enum": []string{"link", "image"}}, "cursor": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 30}, "semantic": map[string]any{"type": "boolean"}}}},
		map[string]any{"name": "get_bookmark", "description": "Get one of the authenticated user's bookmarks by ID.", "execution": execution, "inputSchema": map[string]any{"$schema": schema, "type": "object", "properties": map[string]any{"id": uuid}, "required": []string{"id"}}},
		map[string]any{"name": "add_bookmark", "description": "Save a URL as a bookmark using AI categorization.", "execution": execution, "inputSchema": map[string]any{"$schema": schema, "type": "object", "properties": map[string]any{"url": map[string]any{"type": "string", "format": "uri"}}, "required": []string{"url"}}},
		map[string]any{"name": "list_categories", "description": "List the authenticated user's bookmark categories.", "execution": execution, "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	}
}
func callMCPTool(mux *http.ServeMux, r *http.Request, name string, args map[string]any) any {
	method, path := "GET", ""
	var body *bytes.Reader
	switch name {
	case "search_bookmarks":
		q := url.Values{}
		for _, k := range []string{"q", "categoryId", "kind", "cursor", "limit"} {
			if v, ok := args[k]; ok {
				q.Set(k, fmt.Sprint(v))
			}
		}
		if value, ok := args["q"]; ok {
			s, ok := value.(string)
			if !ok {
				return mcpValidation(name, "Invalid input: expected string, received "+mcpType(value), "q")
			}
			s = strings.TrimSpace(s)
			if s == "" {
				return mcpValidation(name, "Too small: expected string to have >=1 characters", "q")
			}
			q.Set("q", s)
		}
		if value, ok := args["categoryId"]; ok {
			s, ok := value.(string)
			if !ok || (s != "none" && !uuidPattern.MatchString(s)) {
				return mcpValidation(name, "Invalid input", "categoryId")
			}
		}
		if value, ok := args["kind"]; ok {
			s, ok := value.(string)
			if !ok || (s != "link" && s != "image") {
				return mcpValidation(name, "Invalid option: expected one of \"link\"|\"image\"", "kind")
			}
		}
		if value, ok := args["cursor"]; ok {
			if _, ok := value.(string); !ok {
				return mcpValidation(name, "Invalid input: expected string, received "+mcpType(value), "cursor")
			}
		}
		semantic := false
		if value, ok := args["semantic"]; ok {
			var valid bool
			semantic, valid = value.(bool)
			if !valid {
				return mcpValidation(name, "Invalid input: expected boolean, received "+mcpType(value), "semantic")
			}
		}
		path = "/api/bookmarks"
		if semantic {
			if !q.Has("q") {
				return mcpValidation(name, "q is required for semantic search", "q")
			}
			if q.Has("categoryId") || q.Has("kind") || q.Has("cursor") {
				return mcpValidation(name, "semantic search cannot be combined with categoryId, kind, or cursor", "semantic")
			}
			path += "/search/semantic"
			if !q.Has("limit") {
				q.Set("limit", "30")
			}
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
	case "get_bookmark":
		id, ok := args["id"].(string)
		if !ok {
			return mcpValidation(name, "Invalid input: expected string, received "+mcpType(args["id"]), "id")
		}
		if !uuidPattern.MatchString(id) {
			return mcpValidation(name, "Invalid UUID", "id")
		}
		path = "/api/bookmarks/" + id
	case "add_bookmark":
		raw, ok := args["url"].(string)
		if !ok {
			return mcpValidation(name, "Invalid input: expected string, received "+mcpType(args["url"]), "url")
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme == "" || strings.ContainsAny(raw, "\r\n\t ") || ((parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == "") {
			return mcpValidation(name, "Invalid URL", "url")
		}
		method = "POST"
		path = "/api/bookmarks"
		b, _ := json.Marshal(map[string]any{"url": raw, "mode": "ai"})
		body = bytes.NewReader(b)
	case "list_categories":
		path = "/api/categories"
	default:
		return mcpToolError("MCP error -32602: Tool " + name + " not found")
	}
	if body == nil {
		body = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, path, body)
	if err != nil {
		return mcpToolError("Internal server error")
	}
	req.Header.Set("Content-Type", "application/json")
	out := &internalResponse{header: make(http.Header)}
	mux.ServeHTTP(out, req)
	var value map[string]any
	if json.Unmarshal(out.body.Bytes(), &value) != nil {
		return mcpToolError("Internal server error")
	}
	if out.status >= 400 {
		if name == "add_bookmark" && out.status == 409 {
			text := "이미 저장된 북마크입니다."
			if e, ok := value["error"].(map[string]any); ok {
				if d, ok := e["details"].(map[string]any); ok {
					if id, ok := d["existingId"].(string); ok {
						text = "이미 저장된 북마크입니다. 기존 북마크 ID: " + id
					}
				}
			}
			return map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}}
		}
		if e, ok := value["error"].(map[string]any); ok {
			if msg, ok := e["message"].(string); ok {
				return mcpToolError(msg)
			}
		}
		return mcpToolError("Internal server error")
	}
	var payload any = value
	if name == "get_bookmark" || name == "add_bookmark" {
		payload = value["bookmark"]
	} else if name == "list_categories" {
		payload = value["items"]
	} else if name == "search_bookmarks" {
		payload = map[string]any{"bookmarks": value["items"], "nextCursor": value["nextCursor"]}
	}
	b, _ := json.Marshal(payload)
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": string(b)}}}
}
func mcpToolError(message string) any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": message}}, "isError": true}
}
func mcpValidation(name, message, path string) any {
	return mcpToolError("MCP error -32602: Input validation error: Invalid arguments for tool " + name + ": " + message + " at " + path)
}
func mcpType(v any) string {
	switch v.(type) {
	case nil:
		return "undefined"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case []any:
		return "array"
	default:
		return "object"
	}
}
