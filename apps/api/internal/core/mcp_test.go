package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMCPToolCarriesAuthenticatedUserContext(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/bookmarks/{id}", func(w http.ResponseWriter, r *http.Request) {
		if got := UserID(r); got != "user-123" {
			t.Errorf("internal request user = %q", got)
		}
		JSON(w, http.StatusOK, map[string]any{"bookmark": map[string]any{"id": r.PathValue("id"), "userId": UserID(r)}})
	})
	RegisterMCP(mux)
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bookmark","arguments":{"id":"ddcf0729-6ba8-4b15-927a-c984ec8e1c2f"}}}`)
	r := WithUserID(httptest.NewRequest(http.MethodPost, "/api/mcp", bytes.NewReader(body)), "user-123")
	r.Header.Set("Accept", "application/json, text/event-stream")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", w.Code, w.Body.String())
	}
	var result struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Result.IsError || len(result.Result.Content) != 1 {
		t.Fatalf("unexpected MCP result: %s", w.Body.String())
	}
	var bookmark struct {
		UserID string `json:"userId"`
	}
	if err := json.Unmarshal([]byte(result.Result.Content[0].Text), &bookmark); err != nil {
		t.Fatal(err)
	}
	if bookmark.UserID != "user-123" {
		t.Fatalf("tool returned user %q", bookmark.UserID)
	}
}
