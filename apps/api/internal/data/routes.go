package data

import (
	"context"
	"net/http"
	"os"
	"strings"

	"my-bookmark/api/internal/core"
)

func storageURL() string { return os.Getenv("SUPABASE_URL") }
func Register(mux *http.ServeMux, a *core.App) {
	mux.HandleFunc("GET /api/bookmarks", bookmarksRoute(a))
	mux.HandleFunc("POST /api/bookmarks", bookmarksRoute(a))
	mux.HandleFunc("GET /api/bookmarks/search/semantic", semanticRoute(a))
	mux.HandleFunc("GET /api/bookmarks/{id}", bookmarksRoute(a))
	mux.HandleFunc("PATCH /api/bookmarks/{id}", bookmarksRoute(a))
	mux.HandleFunc("DELETE /api/bookmarks/{id}", bookmarksRoute(a))
	mux.HandleFunc("POST /api/bookmarks/{id}/categorize", categorizeRoute(a))
	mux.HandleFunc("GET /api/categories", categoriesRoute(a))
	mux.HandleFunc("POST /api/categories", categoriesRoute(a))
	mux.HandleFunc("PATCH /api/categories/{id}", categoriesRoute(a))
	mux.HandleFunc("DELETE /api/categories/{id}", categoriesRoute(a))
	mux.HandleFunc("PUT /api/categories/order", categoryOrderRoute(a))
	mux.HandleFunc("GET /api/places", placeRoute(a))
}
func bookmarksRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user := core.UserID(r)
		id := r.PathValue("id")
		switch r.Method {
		case "POST":
			var in CreateBookmarkInput
			if core.Decode(r, &in) != nil {
				WriteError(w, validation("Validation failed"))
				return
			}
			b, e := CreateLinkBookmark(ctx, a, user, in)
			if e != nil {
				WriteError(w, e)
				return
			}
			core.JSON(w, 201, map[string]any{"bookmark": b})
		case "GET":
			if id != "" {
				b, e := GetBookmark(ctx, a, user, id)
				if e != nil {
					WriteError(w, e)
					return
				}
				core.JSON(w, 200, map[string]any{"bookmark": b})
				return
			}
			q := r.URL.Query()
			limit, e := parseLimit(q, 30)
			if e != nil {
				WriteError(w, e)
				return
			}
			query := strings.TrimSpace(q.Get("q"))
			if q.Has("q") && query == "" {
				WriteError(w, validationIssue("q", "Too small: expected string to have >=1 characters"))
				return
			}
			result, e := ListBookmarks(ctx, a, user, BookmarkListQuery{CategoryID: q.Get("categoryId"), Kind: q.Get("kind"), Q: query, Cursor: q.Get("cursor"), Limit: limit})
			if e != nil {
				WriteError(w, e)
				return
			}
			core.JSON(w, 200, map[string]any{"items": result.Bookmarks, "nextCursor": result.NextCursor})
		case "PATCH":
			var body map[string]any
			if core.Decode(r, &body) != nil {
				WriteError(w, validation("Validation failed"))
				return
			}
			b, e := updateBookmark(ctx, a, user, id, body)
			if e != nil {
				WriteError(w, e)
				return
			}
			core.JSON(w, 200, map[string]any{"bookmark": b})
		case "DELETE":
			if e := deleteBookmark(ctx, a, user, id); e != nil {
				WriteError(w, e)
				return
			}
			w.WriteHeader(204)
		}
	}
}
func semanticRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if !query.Has("q") {
			WriteError(w, validationIssue("q", "Invalid input: expected string, received undefined"))
			return
		}
		q := strings.TrimSpace(query.Get("q"))
		if q == "" {
			WriteError(w, validationIssue("q", "Too small: expected string to have >=1 characters"))
			return
		}
		limit, e := parseLimit(query, 20)
		if e != nil {
			WriteError(w, e)
			return
		}
		result, e := SearchSemanticBookmarks(r.Context(), a, core.UserID(r), q, limit)
		if e != nil {
			WriteError(w, e)
			return
		}
		core.JSON(w, 200, map[string]any{"items": result.Bookmarks, "nextCursor": nil})
	}
}
func categorizeRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user := core.UserID(r)
		id := r.PathValue("id")
		if !uuid(id) {
			WriteError(w, validation("Validation failed"))
			return
		}
		q := oneQuery(user, id)
		q.Set("select", bookmarkColumns)
		rr, e := rows(ctx, a, "PATCH", "bookmarks", q, map[string]any{"ai_status": "pending"})
		if e != nil {
			WriteError(w, e)
			return
		}
		if len(rr) == 0 {
			WriteError(w, fail(404, "NOT_FOUND", "Bookmark not found"))
			return
		}
		mapped, e := mapBookmarks(ctx, a, user, rr, false)
		if e != nil {
			WriteError(w, e)
			return
		}
		if a.Categorize != nil {
			go a.Categorize(context.Background(), user, id)
		}
		core.JSON(w, 200, map[string]any{"bookmark": mapped[0]})
	}
}
