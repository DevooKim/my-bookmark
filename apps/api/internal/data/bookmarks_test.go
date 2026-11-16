package data

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-bookmark/api/internal/core"
)

const testUser = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const testOtherUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const testBookmark = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

func TestBookmarkRoutesScopeAndResponse(t *testing.T) {
	row := map[string]any{"id": testBookmark, "user_id": testUser, "kind": "link", "url": "https://example.com/", "title": "Example", "description": nil, "site_name": nil, "favicon_url": nil, "og_image_url": nil, "category_id": nil, "tags": []string{}, "metadata": map[string]string{}, "ai_status": "idle", "ai_model": nil, "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/rest/v1/bookmarks":
			if r.URL.Query().Get("user_id") != "eq."+testUser {
				t.Errorf("unscoped bookmark query: %s", r.URL.RawQuery)
				fmt.Fprint(w, `[]`)
				return
			}
			if r.URL.Query().Get("id") != "eq."+testBookmark {
				t.Errorf("wrong bookmark filter: %s", r.URL.RawQuery)
				fmt.Fprint(w, `[]`)
				return
			}
			json.NewEncoder(w).Encode([]any{row})
		case "/rest/v1/bookmark_places":
			if r.URL.Query().Get("user_id") != "eq."+testUser || r.URL.Query().Get("bookmark_id") != "in.("+testBookmark+")" {
				t.Errorf("unscoped place query: %s", r.URL.RawQuery)
			}
			fmt.Fprint(w, `[]`)
		case "/rest/v1/rpc/search_bookmarks":
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				t.Error("invalid search payload")
			}
			if body["p_user_id"] != testUser || body["p_limit"] != float64(2) {
				t.Errorf("invalid user-scoped search payload: %#v", body)
			}
			json.NewEncoder(w).Encode([]any{row})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	t.Setenv("SUPABASE_URL", server.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "test-secret")
	mux := http.NewServeMux()
	Register(mux, &core.App{Client: server.Client()})
	for _, path := range []string{"/api/bookmarks/" + testBookmark, "/api/bookmarks?limit=1"} {
		r := httptest.NewRequest("GET", path, nil)
		r = core.WithUserID(r, testUser)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s returned %d: %s", path, w.Code, w.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		var bookmark map[string]any
		if strings.Contains(path, "?") {
			items, ok := body["items"].([]any)
			if !ok || len(items) != 1 {
				t.Fatalf("invalid items: %#v", body)
			}
			bookmark = items[0].(map[string]any)
			if cursor, ok := body["nextCursor"]; !ok || cursor != nil {
				t.Fatalf("invalid cursor: %#v", body)
			}
		} else {
			bookmark, _ = body["bookmark"].(map[string]any)
		}
		if bookmark == nil || bookmark["id"] != testBookmark || bookmark["userId"] != testUser || bookmark["kind"] != "link" || bookmark["image"] != nil || bookmark["siteName"] != nil {
			t.Fatalf("invalid bookmark contract: %#v", bookmark)
		}
		if places, ok := bookmark["places"].([]any); !ok || len(places) != 0 {
			t.Fatalf("invalid places: %#v", bookmark)
		}
	}
}

func TestBookmarkGetCannotReadAnotherUsersRow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/v1/bookmarks" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.URL.Query().Get("user_id") != "eq."+testOtherUser || r.URL.Query().Get("id") != "eq."+testBookmark {
			t.Errorf("missing ownership filter: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[]`)
	}))
	defer server.Close()
	t.Setenv("SUPABASE_URL", server.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "test-secret")
	mux := http.NewServeMux()
	Register(mux, &core.App{Client: server.Client()})
	r := core.WithUserID(httptest.NewRequest("GET", "/api/bookmarks/"+testBookmark, nil), testOtherUser)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Error.Code != "NOT_FOUND" || body.Error.Message != "Bookmark not found" {
		t.Fatalf("invalid error contract: %s", w.Body.String())
	}
}
