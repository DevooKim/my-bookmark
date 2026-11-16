package ai

import (
	"context"
	"encoding/json"
	"html"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"my-bookmark/api/internal/core"
)

func replacePlaces(ctx context.Context, a *core.App, user, id string, places []place) error {
	q := url.Values{"user_id": {"eq." + user}, "bookmark_id": {"eq." + id}}
	if _, e := db(ctx, a, "DELETE", "bookmark_places", q, nil, ""); e != nil {
		return e
	}
	if len(places) == 0 {
		return nil
	}
	values := make([]map[string]any, 0, len(places))
	for i, p := range places {
		status := "pending"
		if p.CountryCode != nil && *p.CountryCode != "KR" {
			status = "skipped"
		}
		values = append(values, map[string]any{"user_id": user, "bookmark_id": id, "position": i, "name": p.Name, "locality": p.Locality, "country_code": p.CountryCode, "geocode_status": status})
	}
	_, e := db(ctx, a, "POST", "bookmark_places", nil, values, "")
	return e
}

var markup = regexp.MustCompile(`<[^>]*>`)

func geocodePlaces(ctx context.Context, a *core.App, user, id string) {
	clientID, secret := os.Getenv("NAVER_SEARCH_CLIENT_ID"), os.Getenv("NAVER_SEARCH_CLIENT_SECRET")
	if clientID == "" || secret == "" {
		return
	}
	q := url.Values{"select": {"id,user_id,name,locality,country_code"}, "user_id": {"eq." + user}, "bookmark_id": {"eq." + id}, "geocode_status": {"eq.pending"}, "order": {"position.asc"}}
	b, e := db(ctx, a, "GET", "bookmark_places", q, nil, "")
	if e != nil {
		log.Printf("load geocoding: %v", e)
		return
	}
	var rows []struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Locality *string `json:"locality"`
		Country  *string `json:"country_code"`
	}
	if e = json.Unmarshal(b, &rows); e != nil {
		return
	}
	for _, row := range rows {
		if row.Country != nil && *row.Country != "KR" {
			continue
		}
		query := strings.TrimSpace(row.Name)
		if row.Locality != nil && strings.TrimSpace(*row.Locality) != "" {
			query += " " + strings.TrimSpace(*row.Locality)
		}
		u := "https://naverapihub.apigw.ntruss.com/search/v1/local?" + url.Values{"query": {query}, "display": {"5"}}.Encode()
		c, cancel := context.WithTimeout(ctx, 5*time.Second)
		req, e := http.NewRequestWithContext(c, "GET", u, nil)
		if e != nil {
			cancel()
			continue
		}
		req.Header.Set("X-NCP-APIGW-API-KEY-ID", clientID)
		req.Header.Set("X-NCP-APIGW-API-KEY", secret)
		resp, e := client(a).Do(req)
		if e != nil {
			cancel()
			continue
		}
		var data struct {
			Items []struct {
				Title   *string `json:"title"`
				Address string  `json:"address"`
				Road    string  `json:"roadAddress"`
				X       *string `json:"mapx"`
				Y       *string `json:"mapy"`
			} `json:"items"`
		}
		e = json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()
		cancel()
		if e != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 || data.Items == nil {
			continue
		}
		valid := true
		for _, item := range data.Items {
			if item.Title == nil || item.X == nil || item.Y == nil {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		values := map[string]any{"geocode_status": "not_found"}
		for _, item := range data.Items {
			name := identity(row.Name)
			title := identity(html.UnescapeString(markup.ReplaceAllString(*item.Title, "")))
			if name == "" || title == "" || !strings.Contains(name, title) && !strings.Contains(title, name) {
				continue
			}
			x, ex := strconv.ParseFloat(strings.TrimSpace(*item.X), 64)
			y, ey := strconv.ParseFloat(strings.TrimSpace(*item.Y), 64)
			if ex != nil || ey != nil || math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
				continue
			}
			if math.Abs(x) > 360 {
				x /= 1e7
			}
			if math.Abs(y) > 360 {
				y /= 1e7
			}
			if x < 124 || x > 132 || y < 33 || y > 39 {
				continue
			}
			values = map[string]any{"geocode_status": "resolved", "lat": y, "lng": x, "address": strptr(item.Address), "road_address": strptr(item.Road)}
			break
		}
		if _, e = db(ctx, a, "PATCH", "bookmark_places", url.Values{"id": {"eq." + row.ID}, "user_id": {"eq." + user}}, values, ""); e != nil {
			log.Printf("geocode update: %v", e)
		}
	}
}

var sourceHosts = map[string][]string{"youtube": {"youtube.com", "www.youtube.com", "youtu.be"}, "instagram": {"instagram.com", "www.instagram.com"}, "threads": {"threads.net", "www.threads.net"}, "x": {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}, "tiktok": {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}, "github": {"github.com", "www.github.com"}}
var sourceKeys = map[string]string{"youtube": "유튜브", "instagram": "인스타그램", "threads": "스레드", "x": "X", "tiktok": "틱톡", "github": "GitHub"}
var patterns = map[string]*regexp.Regexp{"youtube": regexp.MustCompile(`^[\pL\pN._-]{1,100}$`), "instagram": regexp.MustCompile(`^[A-Za-z0-9._]{1,30}$`), "threads": regexp.MustCompile(`^[A-Za-z0-9._]{1,30}$`), "x": regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`), "tiktok": regexp.MustCompile(`^[A-Za-z0-9._]{2,24}$`), "github": regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$`)}

func sourceEntry(s *source) (string, string) {
	if s == nil || s.Confidence < 0.85 {
		return "", ""
	}
	key := sourceKeys[s.Platform]
	if key == "" {
		return "", ""
	}
	if s.PostURL != nil {
		u, e := url.Parse(*s.PostURL)
		if e == nil && u.Scheme == "https" && u.User == nil && u.Port() == "" && (u.Path != "" && u.Path != "/" || u.RawQuery != "") {
			for _, host := range sourceHosts[s.Platform] {
				if strings.EqualFold(u.Hostname(), host) {
					return key, u.String()
				}
			}
		}
	}
	if s.Platform == "github" && s.Repository != nil {
		p := strings.Split(*s.Repository, "/")
		if len(p) == 2 && validHandle("github", p[0]) && len(p[1]) <= 100 && p[1] != "." && p[1] != ".." && regexp.MustCompile(`^[A-Za-z0-9._-]+$`).MatchString(p[1]) {
			return key, "https://github.com/" + *s.Repository
		}
	}
	if s.Handle == nil {
		return "", ""
	}
	handle := strings.TrimPrefix(*s.Handle, "@")
	if !validHandle(s.Platform, handle) {
		return "", ""
	}
	switch s.Platform {
	case "youtube":
		return key, "https://www.youtube.com/@" + url.PathEscape(handle)
	case "instagram":
		return key, "https://www.instagram.com/" + handle + "/"
	case "threads":
		return key, "https://www.threads.net/@" + handle
	case "x":
		return key, "https://x.com/" + handle
	case "tiktok":
		return key, "https://www.tiktok.com/@" + handle
	case "github":
		return key, "https://github.com/" + handle
	}
	return "", ""
}
func validHandle(platform, s string) bool {
	p := patterns[platform]
	if p == nil || !p.MatchString(s) {
		return false
	}
	if platform == "github" && (len(s) > 39 || strings.Contains(s, "--")) {
		return false
	}
	return true
}
