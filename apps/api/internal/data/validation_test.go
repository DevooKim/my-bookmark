package data

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-bookmark/api/internal/core"
)

func TestStringLengthsUseUTF16CodeUnits(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{{"", 0}, {"한글", 2}, {"😀", 2}, {"a😀한", 4}, {"e\u0301", 2}} {
		if got := strLength(tc.value); got != tc.want {
			t.Errorf("strLength(%q)=%d, want %d", tc.value, got, tc.want)
		}
	}
}

func TestCategoryNameAstralLengthBoundary(t *testing.T) {
	for _, tc := range []struct {
		value string
		valid bool
	}{{strings.Repeat("😀", 25), true}, {strings.Repeat("😀", 25) + "a", false}, {strings.Repeat("한", 50), true}} {
		_, err := categoryName(map[string]any{"name": tc.value})
		if (err == nil) != tc.valid {
			t.Errorf("categoryName(%q) error=%v", tc.value, err)
		}
	}
}

func TestBookmarkAstralLengthBoundaries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PATCH" || r.URL.Path != "/rest/v1/bookmarks" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[]`)
	}))
	defer server.Close()
	t.Setenv("SUPABASE_URL", server.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "test-secret")
	app := &core.App{Client: server.Client()}
	cases := []struct {
		name  string
		body  map[string]any
		valid bool
	}{
		{"tag at boundary", map[string]any{"tags": []any{strings.Repeat("😀", 10)}}, true},
		{"tag over boundary", map[string]any{"tags": []any{strings.Repeat("😀", 10) + "a"}}, false},
		{"metadata key at boundary", map[string]any{"metadata": map[string]any{strings.Repeat("😀", 20): "v"}}, true},
		{"metadata key over boundary", map[string]any{"metadata": map[string]any{strings.Repeat("😀", 20) + "a": "v"}}, false},
		{"metadata value at boundary", map[string]any{"metadata": map[string]any{"k": strings.Repeat("😀", 1024)}}, true},
		{"metadata value over boundary", map[string]any{"metadata": map[string]any{"k": strings.Repeat("😀", 1024) + "a"}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := updateBookmark(context.Background(), app, testUser, testBookmark, tc.body)
			var api *APIError
			if !errors.As(err, &api) {
				t.Fatalf("expected API error, got %v", err)
			}
			want := 400
			if tc.valid {
				want = 404
			}
			if api.Status != want {
				t.Fatalf("status=%d, want %d (error %v)", api.Status, want, err)
			}
		})
	}
}
