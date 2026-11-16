package images

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"my-bookmark/api/internal/core"
)

const bucket = "bookmark-images"

type storage struct {
	app       *core.App
	base, key string
}

func newStorage(app *core.App) storage {
	return storage{app: app, base: strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"), key: os.Getenv("SUPABASE_SECRET_KEY")}
}
func storagePath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
func (s storage) request(ctx context.Context, method, endpoint, contentType string, body []byte) ([]byte, error) {
	if s.base == "" || s.key == "" {
		return nil, fmt.Errorf("storage is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, method, s.base+"/storage/v1/"+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("apikey", s.key)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := s.app.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("storage returned %d: %s", resp.StatusCode, data)
	}
	return data, nil
}
func (s storage) upload(ctx context.Context, path string, body []byte, mime string) error {
	_, err := s.request(ctx, http.MethodPost, "object/"+bucket+"/"+storagePath(path), mime, body)
	return err
}
func (s storage) remove(ctx context.Context, paths ...string) error {
	body, err := json.Marshal(map[string]any{"prefixes": paths})
	if err != nil {
		return err
	}
	_, err = s.request(ctx, http.MethodDelete, "object/"+bucket, "application/json", body)
	return err
}
func (s storage) sign(ctx context.Context, path string) (string, error) {
	body, err := s.request(ctx, http.MethodPost, "object/sign/"+bucket+"/"+storagePath(path), "application/json", []byte(`{"expiresIn":600}`))
	if err != nil {
		return "", err
	}
	var result struct {
		SignedURL string `json:"signedURL"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if result.SignedURL == "" {
		return "", fmt.Errorf("storage did not return a signed URL")
	}
	if strings.HasPrefix(result.SignedURL, "http://") || strings.HasPrefix(result.SignedURL, "https://") {
		return result.SignedURL, nil
	}
	return s.base + "/storage/v1" + result.SignedURL, nil
}

// LoadImageForAnalysis retrieves a private original and generates the analysis JPEG.
func LoadImageForAnalysis(ctx context.Context, app *core.App, originalPath string) ([]byte, error) {
	raw, err := newStorage(app).request(ctx, http.MethodGet, "object/"+bucket+"/"+storagePath(originalPath), "", nil)
	if err != nil {
		return nil, err
	}
	image, err := processImage(raw, originalPath, false, true)
	if err != nil {
		return nil, err
	}
	return image.AnalysisImage, nil
}
