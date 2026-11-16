package data

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"

	"my-bookmark/api/internal/core"
)

type APIError struct {
	Status        int
	Code, Message string
	Details       any
}

func (e *APIError) Error() string { return e.Message }
func fail(status int, code, msg string) error {
	return &APIError{Status: status, Code: code, Message: msg}
}
func validation(msg string) error { return fail(400, "VALIDATION_ERROR", msg) }
func validationIssue(field, message string) error {
	fields := map[string][]string{}
	form := []string{}
	if field == "" {
		form = append(form, message)
	} else {
		fields[field] = []string{message}
	}
	return &APIError{Status: 400, Code: "VALIDATION_ERROR", Message: "Validation failed", Details: map[string]any{"fieldErrors": fields, "formErrors": form}}
}
func WriteError(w http.ResponseWriter, err error) {
	var e *APIError
	if errors.As(err, &e) {
		v := map[string]any{"code": e.Code, "message": e.Message}
		if e.Details != nil {
			v["details"] = e.Details
		}
		core.JSON(w, e.Status, map[string]any{"error": v})
		return
	}
	core.Error(w, 500, "INTERNAL", "Internal server error")
}

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func uuid(s string) bool                  { return uuidRE.MatchString(s) }
func userQuery(user string) url.Values    { return url.Values{"user_id": {"eq." + user}} }
func oneQuery(user, id string) url.Values { q := userQuery(user); q.Set("id", "eq."+id); return q }
func db(ctx context.Context, a *core.App, method, path string, q url.Values, body any, headers http.Header) ([]byte, error) {
	b, s, e := a.DB(ctx, method, path, q, body, headers)
	if e != nil {
		return nil, e
	}
	if s < 200 || s >= 300 {
		return nil, &dbError{status: s, body: b}
	}
	return b, nil
}

type dbError struct {
	status int
	body   []byte
}

func (e *dbError) Error() string { return fmt.Sprintf("database status %d: %s", e.status, e.body) }
func duplicate(err error) bool {
	var d *dbError
	if !errors.As(err, &d) {
		return false
	}
	var x struct {
		Code string `json:"code"`
	}
	json.Unmarshal(d.body, &x)
	return x.Code == "23505"
}
func rows(ctx context.Context, a *core.App, method, path string, q url.Values, body any) ([]map[string]any, error) {
	h := http.Header{}
	if method != "GET" {
		h.Set("Prefer", "return=representation")
	}
	b, e := db(ctx, a, method, path, q, body, h)
	if e != nil {
		return nil, e
	}
	var r []map[string]any
	if len(b) > 0 {
		if e = json.Unmarshal(b, &r); e != nil {
			return nil, e
		}
	}
	if r == nil {
		r = []map[string]any{}
	}
	return r, nil
}
func text(m map[string]any, k string) string { s, _ := m[k].(string); return s }
func domain(s string) string {
	u, _ := url.Parse(s)
	if u == nil {
		return ""
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}
func NormalizeURL(s string) (string, error) {
	u, e := url.Parse(strings.TrimSpace(s))
	if e != nil || u == nil || u.Scheme == "" || u.Host == "" {
		return "", validationIssue("url", "Invalid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", validation("url must use http or https")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	if (u.Scheme == "http" && u.Port() == "80") || (u.Scheme == "https" && u.Port() == "443") {
		u.Host = u.Hostname()
	}
	if u.Path == "" {
		u.Path = "/"
	}
	u.Fragment = ""
	parts := strings.Split(u.RawQuery, "&")
	kept := make([]string, 0, len(parts))
	changed := false
	for _, part := range parts {
		key, _, _ := strings.Cut(part, "=")
		k, err := url.QueryUnescape(key)
		if err == nil && (strings.HasPrefix(k, "utm_") || k == "fbclid" || k == "gclid") {
			changed = true
			continue
		}
		kept = append(kept, part)
	}
	if changed {
		serialized := make([]string, 0, len(kept))
		for _, part := range kept {
			if part == "" {
				continue
			}
			k, v, _ := strings.Cut(part, "=")
			key, ek := url.QueryUnescape(k)
			value, ev := url.QueryUnescape(v)
			if ek != nil || ev != nil {
				serialized = append(serialized, part)
			} else {
				serialized = append(serialized, url.QueryEscape(key)+"="+url.QueryEscape(value))
			}
		}
		u.RawQuery = strings.Join(serialized, "&")
		u.ForceQuery = false
	}
	return u.String(), nil
}
func strLength(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}

var sharedAddressSpace = netip.MustParsePrefix("100.64.0.0/10")

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsValid() && !sharedAddressSpace.Contains(ip) && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
}

const bookmarkColumns = "id,user_id,kind,url,title,description,site_name,favicon_url,og_image_url,category_id,tags,metadata,ai_status,ai_model,image_original_path,image_thumbnail_path,image_mime_type,image_file_size,image_width,image_height,image_filename,created_at,updated_at"
const placeColumns = "id,user_id,bookmark_id,position,name,locality,country_code,geocode_status,lat,lng,address,road_address,created_at"
