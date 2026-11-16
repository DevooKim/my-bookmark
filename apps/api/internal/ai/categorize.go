package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"

	"my-bookmark/api/internal/core"
	"my-bookmark/api/internal/images"
)

type bookmark struct {
	Kind        string            `json:"kind"`
	URL         *string           `json:"url"`
	ImagePath   *string           `json:"image_original_path"`
	Title       *string           `json:"title"`
	Description *string           `json:"description"`
	Site        *string           `json:"site_name"`
	Metadata    map[string]string `json:"metadata"`
}

func db(ctx context.Context, a *core.App, method, table string, q url.Values, body any, prefer string) ([]byte, error) {
	h := http.Header{}
	if prefer != "" {
		h.Set("Prefer", prefer)
	}
	b, status, e := a.DB(ctx, method, table, q, body, h)
	if e != nil {
		return nil, e
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("database status %d: %s", status, b)
	}
	return b, nil
}
func filters(user, id string, pending bool) url.Values {
	q := url.Values{"user_id": {"eq." + user}, "id": {"eq." + id}}
	if pending {
		q.Set("ai_status", "eq.pending")
	}
	return q
}
func categories(ctx context.Context, a *core.App, user string) ([]category, error) {
	b, e := db(ctx, a, "GET", "categories", url.Values{"select": {"id,name"}, "user_id": {"eq." + user}}, nil, "")
	if e != nil {
		return nil, e
	}
	out := []category{}
	e = json.Unmarshal(b, &out)
	return out, e
}
func categoryIdentity(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimLeftFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) })
	return strings.TrimSpace(s)
}
func matchCategory(cs []category, name string) string {
	for _, c := range cs {
		if categoryIdentity(c.Name) == categoryIdentity(name) {
			return c.ID
		}
	}
	return ""
}
func record(ctx context.Context, a *core.App, user, id, provider, model, status string, code any, duration int64, byok *bool) {
	if a.AIUsage != nil {
		a.AIUsage(status == "success")
	}
	_, e := db(ctx, a, "POST", "ai_usage_events", nil, map[string]any{"user_id": user, "bookmark_id": id, "provider": provider, "model": model, "status": status, "error_code": code, "duration_ms": duration, "is_byok": byok}, "")
	if e != nil {
		log.Printf("AI usage event insert failed: %v", e)
	}
}
func Categorize(ctx context.Context, a *core.App, user, id string) {
	failed := func() {
		if _, e := db(ctx, a, "PATCH", "bookmarks", filters(user, id, true), map[string]any{"ai_status": "failed"}, ""); e != nil {
			log.Printf("mark AI failed: %v", e)
		}
	}
	if e := categorize(ctx, a, user, id); e != nil {
		log.Printf("AI categorization failed: %v", e)
		failed()
	}
}
func categorize(ctx context.Context, a *core.App, user, id string) error {
	q := filters(user, id, false)
	q.Set("select", "id,user_id,kind,url,image_original_path,title,description,site_name,metadata,ai_status")
	b, e := db(ctx, a, "GET", "bookmarks", q, nil, "")
	if e != nil {
		return e
	}
	var rows []bookmark
	if e = json.Unmarshal(b, &rows); e != nil {
		return e
	}
	if len(rows) == 0 {
		return nil
	}
	bm := rows[0]
	var meta metadata
	if bm.Kind == "link" {
		if bm.URL == nil {
			return errors.New("missing bookmark URL")
		}
		meta = metadataFetch(ctx, *bm.URL)
		if bm.Title != nil {
			meta.Title = bm.Title
		}
		if meta.Description == nil {
			meta.Description = bm.Description
		}
		if meta.SiteName == nil {
			meta.SiteName = bm.Site
		}
		_, e = db(ctx, a, "PATCH", "bookmarks", filters(user, id, true), map[string]any{"title": meta.Title, "description": meta.Description, "site_name": meta.SiteName, "favicon_url": meta.Favicon, "og_image_url": meta.Image}, "")
		if e != nil {
			return e
		}
	}
	if os.Getenv("OPEN_ROUTER_API_KEY") == "" {
		return errors.New("AI disabled")
	}
	cs, e := categories(ctx, a, user)
	if e != nil {
		return e
	}
	input := map[string]any{"existingCategories": cs}
	image := ""
	if bm.Kind == "image" {
		if bm.ImagePath == nil {
			return errors.New("missing image path")
		}
		image, e = loadImage(ctx, a, *bm.ImagePath)
		if e != nil {
			return e
		}
		input["contentType"] = "image"
		input["instruction"] = "첨부 이미지를 분석해 핵심을 설명하는 한국어 제목, 요약, 태그, 카테고리를 생성한다. OCR 원문 전체를 옮기지 않는다."
	} else {
		input["contentType"] = "link"
		input["url"] = *bm.URL
		input["title"] = meta.Title
		if meta.Description != nil && *meta.Description != "" {
			input["description"] = *meta.Description
		}
		if meta.SiteName != nil && *meta.SiteName != "" {
			input["siteName"] = *meta.SiteName
		}
	}
	start := time.Now()
	result, model, byok, e := analyze(ctx, a, input, image)
	if e != nil {
		code := "unknown"
		var he httpStatusError
		if errors.As(e, &he) {
			code = fmt.Sprint(he.status)
		}
		record(ctx, a, user, id, "openrouter", preset, "failed", code, time.Since(start).Milliseconds(), nil)
		return e
	}
	provider := strings.Split(model, "/")[0]
	if provider == "" {
		provider = "openrouter"
	}
	record(ctx, a, user, id, provider, model, "success", nil, time.Since(start).Milliseconds(), byok)
	if e = apply(ctx, a, user, id, bm, cs, result, model); e != nil {
		record(ctx, a, user, id, "openrouter", preset, "failed", "unknown", time.Since(start).Milliseconds(), nil)
		return e
	}
	tags := filterTags(result.Tags, selectPlaces(result.Places))
	description := result.Summary
	if description == nil {
		description = meta.Description
	}
	if description == nil {
		description = bm.Description
	}
	parts := []string{strings.TrimSpace(result.Title)}
	if description != nil && strings.TrimSpace(*description) != "" {
		parts = append(parts, strings.TrimSpace(*description))
	}
	ts := []string{}
	for _, t := range tags {
		if t = strings.TrimSpace(t); t != "" {
			ts = append(ts, t)
		}
	}
	if len(ts) > 0 {
		parts = append(parts, strings.Join(ts, " "))
	}
	go func() {
		ctx := context.Background()
		v, e := Embed(ctx, a, strings.Join(parts, "\n"))
		if e == nil {
			_, e = db(ctx, a, "PATCH", "bookmarks", filters(user, id, false), map[string]any{"embedding": v}, "")
		}
		if e != nil {
			log.Printf("embedding update failed: %v", e)
		}
	}()
	return nil
}
func loadImage(ctx context.Context, a *core.App, path string) (string, error) {
	data, e := images.LoadImageForAnalysis(ctx, a, path)
	if e != nil {
		return "", e
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data), nil
}
func apply(ctx context.Context, a *core.App, user, id string, bm bookmark, cs []category, r analysis, model string) error {
	var categoryID any
	switch r.Category.Type {
	case "existing":
		for _, c := range cs {
			if c.ID == *r.Category.CategoryID {
				categoryID = c.ID
				break
			}
		}
	case "new":
		name := *r.Category.Name
		found := matchCategory(cs, name)
		if found == "" {
			current, e := categories(ctx, a, user)
			if e != nil {
				return e
			}
			found = matchCategory(current, name)
		}
		if found == "" {
			b, e := db(ctx, a, "POST", "categories", url.Values{"select": {"id"}}, map[string]any{"user_id": user, "name": name}, "return=representation")
			if e != nil {
				current, er := categories(ctx, a, user)
				if er != nil {
					return e
				}
				found = matchCategory(current, name)
				if found == "" {
					return e
				}
			} else {
				var created []category
				if e = json.Unmarshal(b, &created); e != nil || len(created) == 0 {
					return errors.New("category insert failed")
				}
				found = created[0].ID
			}
		}
		categoryID = found
	}
	places := selectPlaces(r.Places)
	values := map[string]any{"category_id": categoryID, "title": r.Title, "tags": filterTags(r.Tags, places), "ai_status": "done", "ai_model": model, "places_analyzed_at": time.Now().UTC().Format(time.RFC3339Nano)}
	if r.Summary != nil && *r.Summary != "" {
		values["description"] = *r.Summary
	}
	if bm.Metadata == nil {
		bm.Metadata = map[string]string{}
	}
	changed := false
	if strings.HasPrefix(bm.Metadata["네이버지도"], "https://map.naver.com/p/search/") {
		delete(bm.Metadata, "네이버지도")
		changed = true
	}
	if bm.Kind == "image" {
		if k, v := sourceEntry(r.Source); k != "" && length(v) <= 2048 {
			_, exists := bm.Metadata[k]
			if exists || len(bm.Metadata) < 10 {
				bm.Metadata[k] = v
				changed = true
			}
		}
	}
	if changed {
		values["metadata"] = bm.Metadata
	}
	q := filters(user, id, true)
	q.Set("select", "id")
	b, e := db(ctx, a, "PATCH", "bookmarks", q, values, "return=representation")
	if e != nil {
		return e
	}
	var updated []json.RawMessage
	if e = json.Unmarshal(b, &updated); e != nil {
		return e
	}
	if len(updated) == 0 {
		return nil
	}
	if e = replacePlaces(ctx, a, user, id, places); e != nil {
		log.Printf("places save failed: %v", e)
		_, _ = db(ctx, a, "PATCH", "bookmarks", filters(user, id, false), map[string]any{"places_analyzed_at": nil}, "")
		return nil
	}
	if len(places) > 0 {
		geocodePlaces(ctx, a, user, id)
	}
	return nil
}
