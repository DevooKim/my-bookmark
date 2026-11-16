package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMCPCompatibilityResponses(t *testing.T) {
	mux := http.NewServeMux()
	RegisterMCP(mux)
	mux.HandleFunc("GET /api/bookmarks", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"items": []any{}, "nextCursor": nil})
	})
	cases := []struct {
		name, body, want string
		status           int
	}{
		{"search", `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_bookmarks","arguments":{}}}`, `"bookmarks":[]`, 200},
		{"semantic missing query", `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_bookmarks","arguments":{"semantic":true}}}`, `q is required for semantic search at q`, 200},
		{"semantic conflict", `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_bookmarks","arguments":{"semantic":true,"q":"test","kind":"link"}}}`, `semantic search cannot be combined with categoryId, kind, or cursor at semantic`, 200},
		{"invalid uuid", `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_bookmark","arguments":{"id":"bad"}}}`, `Invalid UUID at id`, 200},
		{"invalid url", `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"add_bookmark","arguments":{"url":"bad"}}}`, `Invalid URL at url`, 200},
		{"unknown tool", `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"unknown"}}`, `MCP error -32602: Tool unknown not found`, 200},
		{"invalid rpc", `{"jsonrpc":"1.0"}`, `Parse error: Invalid JSON-RPC message`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := WithUserID(httptest.NewRequest("POST", "/api/mcp", bytes.NewBufferString(tc.body)), "user")
			r.Header.Set("Accept", "application/json, text/event-stream")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
			var result map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			var text string
			if e, ok := result["error"].(map[string]any); ok {
				text, _ = e["message"].(string)
			} else {
				content := result["result"].(map[string]any)["content"].([]any)
				text = content[0].(map[string]any)["text"].(string)
			}
			if !strings.Contains(text, tc.want) {
				t.Fatalf("text %q does not contain %q", text, tc.want)
			}
		})
	}
}
