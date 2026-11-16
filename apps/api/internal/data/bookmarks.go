package data

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"my-bookmark/api/internal/core"
)

type CreateBookmarkInput struct {
	URL        string  `json:"url"`
	Mode       string  `json:"mode"`
	CategoryID *string `json:"categoryId"`
	Title      *string `json:"title"`
}
type BookmarkListQuery struct {
	CategoryID, Kind, Q, Cursor string
	Limit                       int
}
type BookmarkListResult struct {
	Bookmarks  []map[string]any
	NextCursor *string
}

func CreateLinkBookmark(ctx context.Context, a *core.App, user string, in CreateBookmarkInput) (map[string]any, error) {
	u, e := NormalizeURL(in.URL)
	if e != nil {
		return nil, e
	}
	if in.Mode != "ai" && in.Mode != "manual" && in.Mode != "none" {
		return nil, validation("Validation failed")
	}
	if in.Title != nil && *in.Title == "" {
		return nil, validation("Validation failed")
	}
	if in.Mode == "manual" {
		if in.CategoryID == nil || !uuid(*in.CategoryID) {
			return nil, validation("Validation failed")
		}
		if e = assertCategory(ctx, a, user, *in.CategoryID); e != nil {
			return nil, e
		}
	} else if in.CategoryID != nil {
		return nil, validation("Validation failed")
	}
	status := "idle"
	if in.Mode == "ai" {
		status = "pending"
	}
	q := url.Values{"select": {bookmarkColumns}}
	rr, e := rows(ctx, a, "POST", "bookmarks", q, map[string]any{"user_id": user, "url": u, "title": in.Title, "category_id": in.CategoryID, "ai_status": status})
	if e != nil {
		return nil, bookmarkError(ctx, a, user, u, e)
	}
	if len(rr) == 0 {
		return nil, fmt.Errorf("missing inserted bookmark")
	}
	b, e := mapBookmark(ctx, a, rr[0], false, nil)
	if e != nil {
		return nil, e
	}
	id := text(rr[0], "id")
	if in.Mode == "ai" {
		if a.Categorize != nil {
			go a.Categorize(context.Background(), user, id)
		}
	} else {
		go updateMetadata(a, user, id, u, in.Title)
	}
	return b, nil
}
func bookmarkError(ctx context.Context, a *core.App, user, u string, e error) error {
	if !duplicate(e) {
		return e
	}
	q := userQuery(user)
	q.Set("select", "id")
	q.Set("url", "eq."+u)
	rr, _ := rows(ctx, a, "GET", "bookmarks", q, nil)
	d := map[string]any{}
	if len(rr) > 0 {
		d["existingId"] = rr[0]["id"]
	}
	return &APIError{Status: 409, Code: "CONFLICT", Message: "이미 저장된 링크", Details: d}
}
func GetBookmark(ctx context.Context, a *core.App, user, id string) (map[string]any, error) {
	if !uuid(id) {
		return nil, validationIssue("", "Invalid UUID")
	}
	q := oneQuery(user, id)
	q.Set("select", bookmarkColumns)
	rr, e := rows(ctx, a, "GET", "bookmarks", q, nil)
	if e != nil {
		return nil, e
	}
	if len(rr) == 0 {
		return nil, fail(404, "NOT_FOUND", "Bookmark not found")
	}
	v, e := mapBookmarks(ctx, a, user, rr, true)
	if e != nil {
		return nil, e
	}
	return v[0], nil
}
func ListBookmarks(ctx context.Context, a *core.App, user string, q BookmarkListQuery) (BookmarkListResult, error) {
	result := BookmarkListResult{}
	if q.Limit < 1 || q.Limit > 100 {
		return result, validation("Validation failed")
	}
	var created, id any
	if q.Cursor != "" {
		b, e := base64.RawURLEncoding.DecodeString(q.Cursor)
		var cur struct {
			CreatedAt string `json:"createdAt"`
			ID        string `json:"id"`
		}
		if e != nil || json.Unmarshal(b, &cur) != nil || !uuid(cur.ID) {
			return result, validation("Invalid cursor")
		}
		created = cur.CreatedAt
		id = cur.ID
	}
	var category, kind, query any
	if q.CategoryID != "" && q.CategoryID != "none" {
		if !uuid(q.CategoryID) {
			return result, validation("Validation failed")
		}
		category = q.CategoryID
	}
	if q.Kind != "" {
		if q.Kind != "link" && q.Kind != "image" {
			return result, validation("Validation failed")
		}
		kind = q.Kind
	}
	if q.Q != "" {
		query = q.Q
	}
	params := map[string]any{"p_user_id": user, "p_query": query, "p_category_id": category, "p_uncategorized": q.CategoryID == "none", "p_kind": kind, "p_cursor_created_at": created, "p_cursor_id": id, "p_limit": q.Limit + 1}
	rr, e := rows(ctx, a, "POST", "rpc/search_bookmarks", url.Values{"select": {bookmarkColumns}}, params)
	if e != nil {
		return result, e
	}
	if len(rr) > q.Limit {
		rr = rr[:q.Limit]
		last := rr[len(rr)-1]
		b, _ := json.Marshal(map[string]any{"createdAt": last["created_at"], "id": last["id"]})
		s := base64.RawURLEncoding.EncodeToString(b)
		result.NextCursor = &s
	}
	result.Bookmarks, e = mapBookmarks(ctx, a, user, rr, false)
	return result, e
}
func SearchSemanticBookmarks(ctx context.Context, a *core.App, user, q string, limit int) (BookmarkListResult, error) {
	out := BookmarkListResult{}
	if a.Embed == nil {
		return out, fail(500, "INTERNAL", "Semantic search is not configured")
	}
	v, e := a.Embed(ctx, q)
	if e != nil {
		return out, e
	}
	encoded, e := json.Marshal(v)
	if e != nil {
		return out, e
	}
	rr, e := rows(ctx, a, "POST", "rpc/semantic_search_bookmarks", url.Values{"select": {bookmarkColumns}}, map[string]any{"p_user_id": user, "p_embedding": string(encoded), "p_limit": limit})
	if e != nil {
		return out, e
	}
	out.Bookmarks, e = mapBookmarks(ctx, a, user, rr, false)
	return out, e
}
func parseLimit(q url.Values, def int) (int, error) {
	if !q.Has("limit") {
		return def, nil
	}
	value := strings.TrimSpace(q.Get("limit"))
	if value == "" {
		value = "0"
	}
	f, e := strconv.ParseFloat(value, 64)
	if e != nil {
		return 0, validationIssue("limit", "Invalid input: expected number, received NaN")
	}
	if f != float64(int64(f)) {
		return 0, validationIssue("limit", "Invalid input: expected int, received number")
	}
	if f < 1 {
		return 0, validationIssue("limit", "Too small: expected number to be >=1")
	}
	if f > 100 {
		return 0, validationIssue("limit", "Too big: expected number to be <=100")
	}
	return int(f), nil
}
func updateBookmark(ctx context.Context, a *core.App, user, id string, b map[string]any) (map[string]any, error) {
	if !uuid(id) {
		return nil, validation("Validation failed")
	}
	updates := map[string]any{}
	embedding := false
	for k, v := range b {
		switch k {
		case "url":
			s, ok := v.(string)
			if !ok {
				return nil, validation("Validation failed")
			}
			u, e := NormalizeURL(s)
			if e != nil {
				return nil, e
			}
			q := oneQuery(user, id)
			q.Set("select", "kind")
			rr, e := rows(ctx, a, "GET", "bookmarks", q, nil)
			if e != nil {
				return nil, e
			}
			if len(rr) == 0 {
				return nil, fail(404, "NOT_FOUND", "Bookmark not found")
			}
			if text(rr[0], "kind") == "image" {
				return nil, validation("이미지 항목의 URL은 변경할 수 없습니다")
			}
			updates["url"] = u
		case "title", "description":
			if v != nil {
				s, ok := v.(string)
				if !ok || (k == "title" && s == "") {
					return nil, validation("Validation failed")
				}
			}
			updates[k] = v
			embedding = true
		case "categoryId":
			if v != nil {
				s, ok := v.(string)
				if !ok || !uuid(s) {
					return nil, validation("Validation failed")
				}
				if e := assertCategory(ctx, a, user, s); e != nil {
					return nil, e
				}
			}
			updates["category_id"] = v
		case "tags":
			arr, ok := v.([]any)
			if !ok || len(arr) > 5 {
				return nil, validation("Validation failed")
			}
			tags := []string{}
			seen := map[string]bool{}
			for _, x := range arr {
				s, ok := x.(string)
				s = strings.TrimSpace(s)
				if !ok || strLength(s) < 1 || strLength(s) > 20 {
					return nil, validation("Validation failed")
				}
				if !seen[s] {
					tags = append(tags, s)
					seen[s] = true
				}
			}
			updates[k] = tags
			embedding = true
		case "metadata":
			obj, ok := v.(map[string]any)
			if !ok || len(obj) > 10 {
				return nil, validation("Validation failed")
			}
			m := map[string]string{}
			for key, x := range obj {
				key = strings.TrimSpace(key)
				s, ok := x.(string)
				s = strings.TrimSpace(s)
				if !ok || strLength(key) < 1 || strLength(key) > 40 || key == "__proto__" || key == "prototype" || key == "constructor" || strLength(s) < 1 || strLength(s) > 2048 {
					return nil, validation("Validation failed")
				}
				m[key] = s
			}
			updates[k] = m
		}
	}
	if len(updates) == 0 {
		return nil, validation("Validation failed")
	}
	updates["ai_status"] = "idle"
	q := oneQuery(user, id)
	q.Set("select", bookmarkColumns)
	rr, e := rows(ctx, a, "PATCH", "bookmarks", q, updates)
	if e != nil {
		return nil, bookmarkError(ctx, a, user, text(updates, "url"), e)
	}
	if len(rr) == 0 {
		return nil, fail(404, "NOT_FOUND", "Bookmark not found")
	}
	if embedding && a.Embed != nil {
		go updateEmbedding(a, user, id, rr[0])
	}
	mapped, e := mapBookmarks(ctx, a, user, rr, true)
	if e != nil {
		return nil, e
	}
	return mapped[0], nil
}
func updateEmbedding(a *core.App, user, id string, r map[string]any) {
	parts := []string{}
	for _, k := range []string{"title", "description"} {
		s := strings.TrimSpace(text(r, k))
		if s != "" {
			parts = append(parts, s)
		}
	}
	tags := []string{}
	if t, ok := r["tags"].([]any); ok {
		for _, v := range t {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				tags = append(tags, strings.TrimSpace(s))
			}
		}
	}
	if len(tags) > 0 {
		parts = append(parts, strings.Join(tags, " "))
	}
	ctx := context.Background()
	vec, e := a.Embed(ctx, strings.Join(parts, "\n"))
	if e == nil {
		_, _ = db(ctx, a, "PATCH", "bookmarks", oneQuery(user, id), map[string]any{"embedding": vec}, nil)
	}
}
func deleteBookmark(ctx context.Context, a *core.App, user, id string) error {
	if !uuid(id) {
		return validation("Validation failed")
	}
	q := oneQuery(user, id)
	q.Set("select", bookmarkColumns)
	rr, e := rows(ctx, a, "GET", "bookmarks", q, nil)
	if e != nil {
		return e
	}
	if len(rr) == 0 {
		return fail(404, "NOT_FOUND", "Bookmark not found")
	}
	row := rr[0]
	if text(row, "kind") == "image" {
		orig, thumb := text(row, "image_original_path"), text(row, "image_thumbnail_path")
		if orig == "" || thumb == "" {
			return fmt.Errorf("missing storage paths")
		}
		_, s, e := a.Storage(ctx, "DELETE", "object/bookmark-images", map[string]any{"prefixes": []string{orig, thumb}})
		if e != nil {
			return e
		}
		if s < 200 || s >= 300 {
			return fmt.Errorf("storage removal status %d", s)
		}
	}
	_, e = db(ctx, a, "DELETE", "bookmarks", oneQuery(user, id), nil, nil)
	return e
}
