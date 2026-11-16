package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"my-bookmark/api/internal/core"
)

func signImage(ctx context.Context, a *core.App, path string) (string, error) {
	parts := strings.Split(path, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	b, s, e := a.Storage(ctx, "POST", "object/sign/bookmark-images/"+strings.Join(parts, "/"), map[string]any{"expiresIn": 600})
	if e != nil {
		return "", e
	}
	if s < 200 || s >= 300 {
		return "", fmt.Errorf("storage signing status %d", s)
	}
	var v struct {
		SignedURL string `json:"signedURL"`
	}
	if e = json.Unmarshal(b, &v); e != nil {
		return "", e
	}
	if v.SignedURL == "" {
		return "", fmt.Errorf("missing signed URL")
	}
	u, e := url.Parse(v.SignedURL)
	if e != nil {
		return "", e
	}
	if !u.IsAbs() { // Storage returns an absolute-path URL rooted at /storage/v1.
		base := strings.TrimRight(storageURL(), "/")
		if base == "" {
			return "", fmt.Errorf("missing Supabase URL")
		}
		if !strings.HasPrefix(v.SignedURL, "/storage/v1/") {
			v.SignedURL = "/storage/v1" + v.SignedURL
		}
		return base + v.SignedURL, nil
	}
	return v.SignedURL, nil
}
func mapPlace(r map[string]any) map[string]any {
	name := strings.TrimSpace(text(r, "name"))
	loc := strings.TrimSpace(text(r, "locality"))
	query := name
	if loc != "" {
		if query != "" {
			query += " "
		}
		query += loc
	}
	encoded := strings.ReplaceAll(url.QueryEscape(query), "+", "%20")
	provider := "naver"
	link := "https://map.naver.com/p/search/" + encoded
	if r["country_code"] != nil && text(r, "country_code") != "KR" {
		provider = "google"
		link = "https://www.google.com/maps/search/?api=1&query=" + encoded
	}
	address := r["road_address"]
	if address == nil {
		address = r["address"]
	}
	return map[string]any{"id": r["id"], "name": r["name"], "locality": r["locality"], "countryCode": r["country_code"], "lat": r["lat"], "lng": r["lng"], "address": address, "mapProvider": provider, "mapUrl": link}
}
func loadPlaces(ctx context.Context, a *core.App, user string, ids []string) (map[string][]map[string]any, error) {
	out := map[string][]map[string]any{}
	if len(ids) == 0 {
		return out, nil
	}
	q := userQuery(user)
	q.Set("select", placeColumns)
	q.Set("bookmark_id", "in.("+strings.Join(ids, ",")+")")
	q.Set("order", "position.asc")
	rr, e := rows(ctx, a, "GET", "bookmark_places", q, nil)
	if e != nil {
		return nil, e
	}
	for _, r := range rr {
		id := text(r, "bookmark_id")
		out[id] = append(out[id], mapPlace(r))
	}
	return out, nil
}
func mapBookmarks(ctx context.Context, a *core.App, user string, rr []map[string]any, original bool) ([]map[string]any, error) {
	ids := make([]string, 0, len(rr))
	for _, r := range rr {
		ids = append(ids, text(r, "id"))
	}
	places, e := loadPlaces(ctx, a, user, ids)
	if e != nil {
		return nil, e
	}
	out := make([]map[string]any, 0, len(rr))
	for _, r := range rr {
		m, e := mapBookmark(ctx, a, r, original, places[text(r, "id")])
		if e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, nil
}
func mapBookmark(ctx context.Context, a *core.App, r map[string]any, original bool, places []map[string]any) (map[string]any, error) {
	if places == nil {
		places = []map[string]any{}
	}
	m := map[string]any{"id": r["id"], "userId": r["user_id"], "kind": r["kind"], "url": r["url"], "image": nil, "title": r["title"], "description": r["description"], "siteName": r["site_name"], "faviconUrl": r["favicon_url"], "ogImageUrl": r["og_image_url"], "categoryId": r["category_id"], "tags": r["tags"], "metadata": r["metadata"], "aiStatus": r["ai_status"], "aiModel": r["ai_model"], "places": places, "createdAt": r["created_at"], "updatedAt": r["updated_at"]}
	if m["metadata"] == nil {
		m["metadata"] = map[string]any{}
	}
	if text(r, "kind") == "image" {
		thumb, orig := text(r, "image_thumbnail_path"), text(r, "image_original_path")
		if thumb == "" || orig == "" {
			return nil, fmt.Errorf("image bookmark missing storage paths")
		}
		t, e := signImage(ctx, a, thumb)
		if e != nil {
			return nil, e
		}
		var o any
		if original {
			o, e = signImage(ctx, a, orig)
			if e != nil {
				return nil, e
			}
		}
		m["image"] = map[string]any{"thumbnailUrl": t, "originalUrl": o, "mimeType": r["image_mime_type"], "fileSize": r["image_file_size"], "width": r["image_width"], "height": r["image_height"], "filename": r["image_filename"]}
	}
	return m, nil
}
func ListPlaceGroups(ctx context.Context, a *core.App, user string) ([]map[string]any, error) {
	all := []map[string]any{}
	for offset := 0; ; offset += 1000 {
		q := userQuery(user)
		q.Set("select", placeColumns+",bookmarks!inner(id,kind,url,title,image_filename,image_thumbnail_path,created_at)")
		q.Set("geocode_status", "eq.resolved")
		q.Set("order", "bookmark_id.asc,position.asc")
		q.Set("offset", fmt.Sprint(offset))
		q.Set("limit", "1000")
		page, e := rows(ctx, a, "GET", "bookmark_places", q, nil)
		if e != nil {
			return nil, e
		}
		all = append(all, page...)
		if len(page) < 1000 {
			break
		}
	}
	type group struct {
		b map[string]any
		p []map[string]any
	}
	groups := map[string]*group{}
	for _, r := range all {
		if r["lat"] == nil || r["lng"] == nil {
			continue
		}
		b, ok := r["bookmarks"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("missing embedded bookmark")
		}
		id := text(r, "bookmark_id")
		if groups[id] == nil {
			groups[id] = &group{b: b}
		}
		groups[id].p = append(groups[id].p, mapPlace(r))
	}
	ordered := make([]*group, 0, len(groups))
	for _, g := range groups {
		ordered = append(ordered, g)
	}
	sort.SliceStable(ordered, func(i, j int) bool { return text(ordered[i].b, "created_at") > text(ordered[j].b, "created_at") })
	out := make([]map[string]any, 0, len(ordered))
	for _, g := range ordered {
		b := g.b
		title := text(b, "title")
		kind := text(b, "kind")
		if title == "" {
			if kind == "link" {
				title = domain(text(b, "url"))
				if title == "" {
					title = "제목 없는 링크"
				}
			} else {
				title = text(b, "image_filename")
				if title == "" {
					title = "분석 중인 이미지"
				}
			}
		}
		var thumbnail any
		if kind == "image" && text(b, "image_thumbnail_path") != "" {
			if s, e := signImage(ctx, a, text(b, "image_thumbnail_path")); e == nil {
				thumbnail = s
			}
		}
		out = append(out, map[string]any{"bookmark": map[string]any{"id": b["id"], "kind": kind, "title": title, "url": b["url"], "thumbnailUrl": thumbnail}, "places": g.p})
	}
	return out, nil
}
func placeRoute(a *core.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, e := ListPlaceGroups(r.Context(), a, core.UserID(r))
		if e != nil {
			WriteError(w, e)
			return
		}
		core.JSON(w, 200, map[string]any{"items": v})
	}
}
