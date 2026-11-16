package data

import (
	"context"
	"net/http"
	"strings"

	"my-bookmark/api/internal/core"
)

func mapCategory(r map[string]any) map[string]any {
	return map[string]any{"id": r["id"], "userId": r["user_id"], "name": r["name"], "sortOrder": r["sort_order"], "createdAt": r["created_at"]}
}
func ListCategories(ctx context.Context, a *core.App, user string, counts bool) ([]map[string]any, error) {
	q := userQuery(user)
	q.Set("select", "*")
	q.Set("order", "sort_order.asc,created_at.asc")
	rr, e := rows(ctx, a, "GET", "categories", q, nil)
	if e != nil {
		return nil, e
	}
	c := map[string]int{}
	if counts {
		q = userQuery(user)
		q.Set("select", "category_id")
		q.Set("category_id", "not.is.null")
		br, e := rows(ctx, a, "GET", "bookmarks", q, nil)
		if e != nil {
			return nil, e
		}
		for _, r := range br {
			c[text(r, "category_id")]++
		}
	}
	out := make([]map[string]any, 0, len(rr))
	for _, r := range rr {
		m := mapCategory(r)
		if counts {
			m["bookmarkCount"] = c[text(r, "id")]
		}
		out = append(out, m)
	}
	return out, nil
}
func assertCategory(ctx context.Context, a *core.App, user, id string) error {
	q := oneQuery(user, id)
	q.Set("select", "id")
	r, e := rows(ctx, a, "GET", "categories", q, nil)
	if e != nil {
		return e
	}
	if len(r) == 0 {
		return validation("categoryId must reference one of your categories")
	}
	return nil
}
func categoryError(e error) error {
	if duplicate(e) {
		return fail(409, "CONFLICT", "이미 있는 카테고리예요")
	}
	return e
}
func categoryName(body map[string]any) (string, error) {
	v, ok := body["name"].(string)
	if !ok {
		kind := "undefined"
		if value, exists := body["name"]; exists {
			switch value.(type) {
			case nil:
				kind = "null"
			case bool:
				kind = "boolean"
			case float64:
				kind = "number"
			case []any:
				kind = "array"
			default:
				kind = "object"
			}
		}
		return "", validationIssue("name", "Invalid input: expected string, received "+kind)
	}
	v = strings.TrimSpace(v)
	if strLength(v) < 1 {
		return "", validationIssue("name", "Too small: expected string to have >=1 characters")
	}
	if strLength(v) > 50 {
		return "", validationIssue("name", "Too big: expected string to have <=50 characters")
	}
	return v, nil
}
func categoriesRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user := core.UserID(r)
		id := r.PathValue("id")
		if id != "" && !uuid(id) {
			WriteError(w, validation("Validation failed"))
			return
		}
		switch r.Method {
		case "GET":
			items, e := ListCategories(ctx, a, user, r.URL.Query().Get("withCounts") == "true")
			if e != nil {
				WriteError(w, e)
				return
			}
			core.JSON(w, 200, map[string]any{"items": items})
		case "POST", "PATCH":
			var b map[string]any
			if core.Decode(r, &b) != nil {
				WriteError(w, validation("Validation failed"))
				return
			}
			name, e := categoryName(b)
			if e != nil {
				WriteError(w, e)
				return
			}
			method := "POST"
			q := userQuery(user)
			body := map[string]any{"name": name, "user_id": user}
			status := 201
			if r.Method == "PATCH" {
				method = "PATCH"
				q = oneQuery(user, id)
				delete(body, "user_id")
				status = 200
			}
			q.Set("select", "*")
			rr, e := rows(ctx, a, method, "categories", q, body)
			if e != nil {
				WriteError(w, categoryError(e))
				return
			}
			if len(rr) == 0 {
				WriteError(w, fail(404, "NOT_FOUND", "Category not found"))
				return
			}
			core.JSON(w, status, map[string]any{"category": mapCategory(rr[0])})
		case "DELETE":
			_, e := db(ctx, a, "DELETE", "categories", oneQuery(user, id), nil, nil)
			if e != nil {
				WriteError(w, e)
				return
			}
			w.WriteHeader(204)
		}
	}
}
func categoryOrderRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			IDs []string `json:"ids"`
		}
		if core.Decode(r, &b) != nil || len(b.IDs) < 1 || len(b.IDs) > 200 {
			WriteError(w, validation("Validation failed"))
			return
		}
		seen := map[string]bool{}
		for _, id := range b.IDs {
			if !uuid(id) {
				WriteError(w, validation("Validation failed"))
				return
			}
			seen[id] = true
		}
		ctx := r.Context()
		user := core.UserID(r)
		q := userQuery(user)
		q.Set("select", "id")
		rr, e := rows(ctx, a, "GET", "categories", q, nil)
		if e != nil {
			WriteError(w, e)
			return
		}
		if len(seen) != len(b.IDs) || len(rr) != len(b.IDs) {
			WriteError(w, validation("ids must include every category exactly once"))
			return
		}
		for _, row := range rr {
			if !seen[text(row, "id")] {
				WriteError(w, validation("ids must include every category exactly once"))
				return
			}
		}
		for i, id := range b.IDs {
			_, e = db(ctx, a, "PATCH", "categories", oneQuery(user, id), map[string]any{"sort_order": i}, nil)
			if e != nil {
				WriteError(w, e)
				return
			}
		}
		items, e := ListCategories(ctx, a, user, false)
		if e != nil {
			WriteError(w, e)
			return
		}
		core.JSON(w, 200, map[string]any{"items": items})
	}
}
