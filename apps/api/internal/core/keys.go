package core

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

type keyRow struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	KeyPrefix  string  `json:"key_prefix"`
	LastUsedAt *string `json:"last_used_at"`
	CreatedAt  string  `json:"created_at"`
}

func (k keyRow) response() map[string]any {
	return map[string]any{"id": k.ID, "name": k.Name, "keyPrefix": k.KeyPrefix, "lastUsedAt": k.LastUsedAt, "createdAt": k.CreatedAt}
}

var uuidPattern = regexp.MustCompile(`(?i)^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

func RegisterKeys(mux *http.ServeMux, app *App) {
	mux.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, map[string]any{"userId": UserID(r)}) })
	mux.HandleFunc("GET /api/keys", func(w http.ResponseWriter, r *http.Request) {
		q := url.Values{"select": {"id,name,key_prefix,last_used_at,created_at"}, "user_id": {"eq." + UserID(r)}, "revoked_at": {"is.null"}, "order": {"created_at.desc"}}
		b, status, err := app.DB(r.Context(), "GET", "api_keys", q, nil, nil)
		if err != nil || status >= 300 {
			Error(w, 500, "INTERNAL", "Internal server error")
			return
		}
		var rows []keyRow
		if json.Unmarshal(b, &rows) != nil {
			Error(w, 500, "INTERNAL", "Internal server error")
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, row.response())
		}
		JSON(w, 200, map[string]any{"items": items})
	})
	mux.HandleFunc("POST /api/keys", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if Decode(r, &body) != nil {
			Error(w, 400, "VALIDATION_ERROR", "Invalid request body")
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if len(utf16.Encode([]rune(body.Name))) < 1 || len(utf16.Encode([]rune(body.Name))) > 80 {
			Error(w, 400, "VALIDATION_ERROR", "Invalid name")
			return
		}
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			Error(w, 500, "INTERNAL", "Internal server error")
			return
		}
		key := "bm_" + base64.RawURLEncoding.EncodeToString(buf)
		q := url.Values{"select": {"id,name,key_prefix,last_used_at,created_at"}}
		h := http.Header{"Prefer": {"return=representation"}}
		b, status, err := app.DB(r.Context(), "POST", "api_keys", q, map[string]any{"user_id": UserID(r), "name": body.Name, "key_hash": HashAPIKey(key), "key_prefix": key[:10]}, h)
		var rows []keyRow
		if err != nil || status >= 300 || json.Unmarshal(b, &rows) != nil || len(rows) != 1 {
			Error(w, 500, "INTERNAL", "Internal server error")
			return
		}
		out := rows[0].response()
		out["key"] = key
		JSON(w, 201, out)
	})
	mux.HandleFunc("DELETE /api/keys/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidPattern.MatchString(id) {
			Error(w, 400, "VALIDATION_ERROR", "Invalid id")
			return
		}
		q := url.Values{"user_id": {"eq." + UserID(r)}, "id": {"eq." + id}}
		_, status, err := app.DB(r.Context(), "PATCH", "api_keys", q, map[string]any{"revoked_at": time.Now().UTC().Format(time.RFC3339Nano)}, nil)
		if err != nil || status >= 300 {
			Error(w, 500, "INTERNAL", "Internal server error")
			return
		}
		w.WriteHeader(204)
	})
}
