package images

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/h2non/bimg"
	"my-bookmark/api/internal/core"
)

const testUser = "11111111-1111-4111-8111-111111111111"

func pngImage(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestProcessImage(t *testing.T) {
	raw := pngImage(t, 1200, 600)
	processed, err := ProcessImage(raw, "photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(processed.Original, raw) || processed.MIMEType != "image/png" || processed.Extension != "png" || processed.Filename != "photo.png" || processed.Width != 1200 || processed.Height != 600 {
		t.Fatalf("unexpected image metadata: %+v", processed)
	}
	thumb, err := bimg.Metadata(processed.Thumbnail)
	if err != nil {
		t.Fatal(err)
	}
	if thumb.Type != "webp" || thumb.Size.Width != 640 || thumb.Size.Height != 320 {
		t.Fatalf("thumbnail metadata: %+v", thumb)
	}
	analysis, err := bimg.Metadata(processed.AnalysisImage)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Type != "jpeg" || analysis.Size.Width != 1200 || analysis.Size.Height != 600 {
		t.Fatalf("analysis metadata: %+v", analysis)
	}
}

func TestProcessHEIC(t *testing.T) {
	raw, err := base64.StdEncoding.DecodeString("AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAEAAAABAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAkwziHuRZVNwICBgCogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAADIAAAAAW1kYXQAAAAAAAAA2AAAAMQoAa+hFbALoF9s2SZe+7Tvdr6eVFsRGbtk5mfwQbP2vj31zWWV9aOO8SwBgx1PxhMVQ7fL3qVYpi4ZR3TD84Ki8I7LbJzDAHRDqYQa1JRBrO7+qduwyB6pm4AHIHE8hkXrbOsTPy995kA5jPWzO7AHfTA1r0WnNqxrMid+VrSjJlJ6AgmfSJxYltnVmphqkwfr4rm6vs6FuBBsORLBHlY1H4prIQMkh5DwnfLfzFyr8E8VnoAbR9DnH7obQf/rxILjxqrY")
	if err != nil {
		t.Fatal(err)
	}
	processed, err := ProcessImage(raw, "iphone.heic")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, processed.Original) || processed.MIMEType != "image/heic" || processed.Extension != "heic" || processed.Width != 16 || processed.Height != 16 {
		t.Fatalf("unexpected HEIC result: %+v", processed)
	}
	thumb, err := bimg.Metadata(processed.Thumbnail)
	if err != nil || thumb.Type != "webp" {
		t.Fatalf("invalid HEIC thumbnail: %+v %v", thumb, err)
	}
}

func TestProcessImageValidation(t *testing.T) {
	tests := []struct {
		name, filename string
		raw            []byte
		status         int
	}{
		{"invalid", "broken.png", []byte("not an image"), 400},
		{"invalid heic", "broken.heic", []byte("not heic"), 400},
		{"too large", "huge.png", make([]byte, MaxImageBytes+1), 413},
		{"unsupported", "image.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`), 415},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ProcessImage(tc.raw, tc.filename)
			problem, ok := err.(*processingError)
			if !ok || problem.status != tc.status {
				t.Fatalf("error = %v, want status %d", err, tc.status)
			}
		})
	}
}

type backend struct {
	uploads                   map[string][]byte
	inserted                  map[string]any
	deleted                   []string
	failThumbnail, failInsert bool
}

func (b *backend) serve(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/storage/v1/object/bookmark-images/"):
		key := strings.TrimPrefix(r.URL.Path, "/storage/v1/object/bookmark-images/")
		if b.failThumbnail && strings.HasSuffix(key, "/thumbnail.webp") {
			http.Error(w, "thumbnail failure", 500)
			return
		}
		body, _ := io.ReadAll(r.Body)
		b.uploads[key] = body
		w.WriteHeader(200)
	case r.Method == http.MethodDelete && r.URL.Path == "/storage/v1/object/bookmark-images":
		var request struct {
			Prefixes []string `json:"prefixes"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			http.Error(w, "bad body", 400)
			return
		}
		b.deleted = append(b.deleted, request.Prefixes...)
		for _, key := range request.Prefixes {
			delete(b.uploads, key)
		}
		w.WriteHeader(200)
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/storage/v1/object/sign/bookmark-images/"):
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"signedURL":"/object/sign/bookmark-images/test?token=abc"}`)
	case r.Method == http.MethodPost && r.URL.Path == "/rest/v1/bookmarks":
		if b.failInsert {
			http.Error(w, "insert failure", 500)
			return
		}
		var row map[string]any
		if json.NewDecoder(r.Body).Decode(&row) != nil {
			http.Error(w, "bad body", 400)
			return
		}
		b.inserted = row
		if row["kind"] == nil {
			row["kind"] = "link"
		}
		if row["id"] == nil {
			row["id"] = "22222222-2222-4222-8222-222222222222"
		}
		row["tags"] = []string{}
		row["metadata"] = map[string]any{}
		row["created_at"] = "2026-01-01T00:00:00Z"
		row["updated_at"] = "2026-01-01T00:00:00Z"
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]any{row})
	default:
		http.Error(w, "unexpected request", 500)
	}
}
func setup(t *testing.T, b *backend) *http.ServeMux {
	t.Helper()
	b.uploads = make(map[string][]byte)
	server := httptest.NewServer(http.HandlerFunc(b.serve))
	t.Cleanup(server.Close)
	t.Setenv("SUPABASE_URL", server.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "secret")
	mux := http.NewServeMux()
	Register(mux, &core.App{Client: server.Client()})
	return mux
}
func multipartRequest(t *testing.T, route, field, filename string, raw []byte, extra map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if filename != "" {
		part, err := writer.CreateFormFile(field, filename)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(raw); err != nil {
			t.Fatal(err)
		}
	}
	for key, value := range extra {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, route, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return core.WithUserID(req, testUser)
}
func perform(mux *http.ServeMux, req *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func TestImageAndShareUploads(t *testing.T) {
	for _, tc := range []struct{ route, field string }{{"/api/images", "image"}, {"/api/share", "item"}} {
		t.Run(tc.route, func(t *testing.T) {
			b := &backend{}
			mux := setup(t, b)
			original := pngImage(t, 100, 50)
			response := perform(mux, multipartRequest(t, tc.route, tc.field, "photo.png", original, nil))
			if response.Code != 201 {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			var result struct {
				Bookmark struct {
					ID    string `json:"id"`
					Image struct {
						ThumbnailURL string `json:"thumbnailUrl"`
						MIMEType     string `json:"mimeType"`
						Width        int    `json:"width"`
					} `json:"image"`
				} `json:"bookmark"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			prefix := testUser + "/" + result.Bookmark.ID + "/"
			if !bytes.Equal(b.uploads[prefix+"original.png"], original) {
				t.Fatal("original not stored intact")
			}
			thumb, err := bimg.Metadata(b.uploads[prefix+"thumbnail.webp"])
			if err != nil || thumb.Type != "webp" {
				t.Fatalf("invalid thumbnail: %+v %v", thumb, err)
			}
			if result.Bookmark.Image.ThumbnailURL == "" || result.Bookmark.Image.MIMEType != "image/png" || result.Bookmark.Image.Width != 100 {
				t.Fatalf("unexpected response: %s", response.Body.String())
			}
		})
	}
}

func TestImageStorageRollback(t *testing.T) {
	for _, tc := range []struct {
		name                      string
		failThumbnail, failInsert bool
		deletes                   int
	}{{"thumbnail failure", true, false, 1}, {"database failure", false, true, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			b := &backend{failThumbnail: tc.failThumbnail, failInsert: tc.failInsert}
			mux := setup(t, b)
			response := perform(mux, multipartRequest(t, "/api/images", "image", "photo.png", pngImage(t, 10, 10), nil))
			if response.Code != 500 {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if len(b.deleted) != tc.deletes || len(b.uploads) != 0 {
				t.Fatalf("rollback: deleted=%v remaining=%v", b.deleted, b.uploads)
			}
		})
	}
}

func TestUploadAndShareValidation(t *testing.T) {
	b := &backend{}
	mux := setup(t, b)
	tests := []struct {
		name    string
		request *http.Request
		status  int
	}{
		{"missing image", multipartRequest(t, "/api/images", "image", "", nil, nil), 400},
		{"unexpected image field", multipartRequest(t, "/api/images", "wrong", "photo.png", []byte("x"), nil), 400},
		{"invalid image", multipartRequest(t, "/api/images", "image", "photo.png", []byte("x"), nil), 400},
		{"oversized image", multipartRequest(t, "/api/images", "image", "photo.png", make([]byte, MaxImageBytes+1), nil), 413},
		{"missing share", multipartRequest(t, "/api/share", "item", "", nil, nil), 400},
		{"ambiguous share", multipartRequest(t, "/api/share", "item", "photo.png", []byte("x"), map[string]string{"item": "https://example.com"}), 400},
		{"invalid shared URL", multipartRequest(t, "/api/share", "item", "", nil, map[string]string{"item": "not a url"}), 400},
		{"wrong share file", multipartRequest(t, "/api/share", "wrong", "photo.png", []byte("x"), nil), 400},
		{"extra share field", multipartRequest(t, "/api/share", "item", "", nil, map[string]string{"item": "https://example.com", "extra": "x"}), 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			response := perform(mux, tc.request)
			if response.Code != tc.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			var body struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != validation {
				t.Fatalf("unexpected error: %s", response.Body.String())
			}
		})
	}
	if len(b.uploads) != 0 {
		t.Fatalf("validation unexpectedly stored files: %v", b.uploads)
	}
}

func TestShareURLEncodedLink(t *testing.T) {
	b := &backend{}
	mux := setup(t, b)
	form := url.Values{"item": {"https://example.com/post"}}
	req := httptest.NewRequest(http.MethodPost, "/api/share", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := perform(mux, core.WithUserID(req, testUser))
	if response.Code != 201 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if b.inserted["url"] != "https://example.com/post" || b.inserted["user_id"] != testUser || b.inserted["ai_status"] != "pending" {
		t.Fatalf("unexpected inserted link: %v", b.inserted)
	}
	if len(b.uploads) != 0 {
		t.Fatalf("link unexpectedly uploaded images: %v", b.uploads)
	}
}
