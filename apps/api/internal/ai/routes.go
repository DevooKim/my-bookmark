package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"my-bookmark/api/internal/core"
)

func Register(mux *http.ServeMux, a *core.App) {
	mux.HandleFunc("GET /api/ai", func(w http.ResponseWriter, r *http.Request) {
		core.JSON(w, 200, map[string]any{"enabled": os.Getenv("OPEN_ROUTER_API_KEY") != "", "preset": preset})
	})
	mux.HandleFunc("POST /api/ai/test", func(w http.ResponseWriter, r *http.Request) {
		key := os.Getenv("OPEN_ROUTER_API_KEY")
		ok := false
		if key != "" {
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()
			ok = request(ctx, a, "GET", baseURL+"/key", key, nil, nil) == nil
		}
		core.JSON(w, 200, map[string]any{"ok": ok})
	})
	mux.HandleFunc("GET /api/ai/usage", func(w http.ResponseWriter, r *http.Request) {
		days, ok := routeDays(w, r)
		if !ok {
			return
		}
		q := url.Values{"select": {"*"}, "user_id": {"eq." + core.UserID(r)}, "created_at": {"gte." + time.Now().Add(-time.Duration(days)*24*time.Hour).UTC().Format(time.RFC3339Nano)}, "order": {"created_at.desc"}, "limit": {"1000"}}
		b, e := db(r.Context(), a, "GET", "ai_usage_events", q, nil, "")
		if e != nil {
			core.Error(w, 500, "INTERNAL", "Failed to load AI usage")
			return
		}
		var rows []struct {
			ID         string  `json:"id"`
			Provider   string  `json:"provider"`
			Model      string  `json:"model"`
			BookmarkID *string `json:"bookmark_id"`
			Status     string  `json:"status"`
			ErrorCode  *string `json:"error_code"`
			Duration   *int64  `json:"duration_ms"`
			Byok       *bool   `json:"is_byok"`
			Created    string  `json:"created_at"`
		}
		if json.Unmarshal(b, &rows) != nil {
			core.Error(w, 500, "INTERNAL", "Failed to load AI usage")
			return
		}
		items := make([]any, 0, len(rows))
		for _, v := range rows {
			items = append(items, map[string]any{"id": v.ID, "provider": v.Provider, "model": v.Model, "bookmarkId": v.BookmarkID, "status": v.Status, "errorCode": v.ErrorCode, "durationMs": v.Duration, "isByok": v.Byok, "createdAt": v.Created})
		}
		core.JSON(w, 200, map[string]any{"days": days, "items": items})
	})
	mux.HandleFunc("GET /api/ai/account", func(w http.ResponseWriter, r *http.Request) {
		key := os.Getenv("OPEN_ROUTER_API_KEY")
		if key == "" {
			core.Error(w, 400, "VALIDATION_ERROR", "OPEN_ROUTER_API_KEY is not configured")
			return
		}
		var res struct {
			Data struct {
				Usage     float64  `json:"usage"`
				Daily     float64  `json:"usage_daily"`
				Weekly    float64  `json:"usage_weekly"`
				Monthly   float64  `json:"usage_monthly"`
				Limit     *float64 `json:"limit"`
				Remaining *float64 `json:"limit_remaining"`
				Free      bool     `json:"is_free_tier"`
			} `json:"data"`
		}
		if request(r.Context(), a, "GET", baseURL+"/key", key, nil, &res) != nil {
			core.Error(w, 502, "INTERNAL", "OpenRouter key lookup failed")
			return
		}
		d := res.Data
		core.JSON(w, 200, map[string]any{"usage": d.Usage, "usageDaily": d.Daily, "usageWeekly": d.Weekly, "usageMonthly": d.Monthly, "limit": d.Limit, "limitRemaining": d.Remaining, "isFreeTier": d.Free})
	})
	mux.HandleFunc("GET /api/ai/analytics", func(w http.ResponseWriter, r *http.Request) {
		days, ok := routeDays(w, r)
		if !ok {
			return
		}
		key := os.Getenv("OPEN_ROUTER_MANAGEMENT_KEY")
		rows := []any{}
		if key != "" {
			end := time.Now().UTC()
			body := map[string]any{"metrics": []string{"total_usage", "tokens_total", "request_count"}, "dimensions": []string{"model"}, "granularity": "day", "time_range": map[string]string{"start": end.Add(-time.Duration(days) * 24 * time.Hour).Format(time.RFC3339Nano), "end": end.Format(time.RFC3339Nano)}}
			var res struct {
				Data struct {
					Data []struct {
						Date     string          `json:"date__day"`
						Model    string          `json:"model"`
						Usage    json.RawMessage `json:"total_usage"`
						Tokens   json.RawMessage `json:"tokens_total"`
						Requests json.RawMessage `json:"request_count"`
					} `json:"data"`
				} `json:"data"`
			}
			if request(r.Context(), a, "POST", baseURL+"/analytics/query", key, body, &res) != nil {
				core.Error(w, 502, "INTERNAL", "OpenRouter analytics query failed")
				return
			}
			for _, v := range res.Data.Data {
				usage, e1 := numeric(v.Usage)
				tokens, e2 := numeric(v.Tokens)
				requests, e3 := numeric(v.Requests)
				if e1 != nil || e2 != nil || e3 != nil {
					core.Error(w, 500, "INTERNAL", "Invalid OpenRouter analytics response")
					return
				}
				rows = append(rows, map[string]any{"date": v.Date, "model": v.Model, "usage": usage, "tokens": tokens, "requests": requests})
			}
		}
		core.JSON(w, 200, map[string]any{"days": days, "configured": key != "", "rows": rows})
	})
}
func routeDays(w http.ResponseWriter, r *http.Request) (int, bool) {
	v := r.URL.Query().Get("days")
	if v == "" {
		if r.URL.Query().Has("days") {
			core.Error(w, 400, "VALIDATION_ERROR", "Invalid days")
			return 0, false
		}
		return 30, true
	}
	n, e := strconv.Atoi(v)
	if e != nil || n < 1 || n > 90 {
		core.Error(w, 400, "VALIDATION_ERROR", "Invalid days")
		return 0, false
	}
	return n, true
}
func numeric(v json.RawMessage) (float64, error) {
	var n float64
	if e := json.Unmarshal(v, &n); e == nil {
		return n, nil
	}
	var s string
	if e := json.Unmarshal(v, &s); e != nil {
		return 0, e
	}
	return strconv.ParseFloat(s, 64)
}
