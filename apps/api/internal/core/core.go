package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type App struct {
	Client       *http.Client
	Categorize   func(context.Context, string, string)
	Embed        func(context.Context, string) ([]float64, error)
	CronStarted  func()
	CronFinished func(CronStats, error)
	AIUsage      func(success bool)
}

type CronStats struct{ Scanned, Claimed, Sent, Failed, Expired int }

// DB calls the Supabase PostgREST API using the server-only secret key. Each
// operation must explicitly scope its query to the authenticated user.
func (a *App) DB(ctx context.Context, method, path string, query url.Values, body any, headers http.Header) ([]byte, int, error) {
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	key := os.Getenv("SUPABASE_SECRET_KEY")
	if base == "" || key == "" {
		return nil, 0, errors.New("database is not configured")
	}
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reader = bytes.NewReader(b)
	}
	u := base + "/rest/v1/" + strings.TrimLeft(path, "/")
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, values := range headers {
		for _, value := range values {
			req.Header.Add(k, value)
		}
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

type userIDKey struct{}

// Storage performs a request against Supabase Storage with admin credentials.
// A []byte body is sent verbatim; other bodies are JSON encoded.
func (a *App) Storage(ctx context.Context, method, path string, body any) ([]byte, int, error) {
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	key := os.Getenv("SUPABASE_SECRET_KEY")
	if base == "" || key == "" {
		return nil, 0, errors.New("storage is not configured")
	}
	var reader io.Reader
	contentType := "application/json"
	if b, ok := body.([]byte); ok {
		reader = bytes.NewReader(b)
		contentType = "application/octet-stream"
	} else if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+"/storage/v1/"+strings.TrimLeft(path, "/"), reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", contentType)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

func WithUserID(r *http.Request, id string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userIDKey{}, id))
}
func UserID(r *http.Request) string { id, _ := r.Context().Value(userIDKey{}).(string); return id }
func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}
func Decode(r *http.Request, value any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(value); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("invalid JSON body")
	}
	return nil
}
