package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBearerJWTAndAPIKeyAuthorization(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	b64 := base64.RawURLEncoding.EncodeToString
	fixed := func(v *big.Int) string { b := make([]byte, 32); v.FillBytes(b); return b64(b) }
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/v1/.well-known/jwks.json":
			JSON(w, 200, map[string]any{"keys": []any{map[string]any{"kty": "EC", "kid": "test-key", "alg": "ES256", "crv": "P-256", "x": fixed(key.X), "y": fixed(key.Y)}}})
		case "/rest/v1/api_keys":
			if r.Method == "GET" {
				JSON(w, 200, []any{map[string]any{"user_id": "api-user", "last_used_at": time.Now().UTC()}})
			} else {
				w.WriteHeader(204)
			}
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("SUPABASE_URL", server.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "test-secret")
	remoteKeys.Lock()
	remoteKeys.keys = nil
	remoteKeys.fetched = time.Time{}
	remoteKeys.lastAttempt = time.Time{}
	remoteKeys.Unlock()
	t.Cleanup(func() {
		remoteKeys.Lock()
		remoteKeys.keys = nil
		remoteKeys.fetched = time.Time{}
		remoteKeys.lastAttempt = time.Time{}
		remoteKeys.Unlock()
	})
	makeJWT := func(aud string) string {
		header, _ := json.Marshal(map[string]any{"alg": "ES256", "kid": "test-key"})
		payload, _ := json.Marshal(map[string]any{"iss": server.URL + "/auth/v1", "aud": aud, "sub": "jwt-user", "exp": time.Now().Add(time.Minute).Unix()})
		raw := b64(header) + "." + b64(payload)
		h := sha256.Sum256([]byte(raw))
		x, y, err := ecdsa.Sign(rand.Reader, key, h[:])
		if err != nil {
			t.Fatal(err)
		}
		signature := make([]byte, 64)
		x.FillBytes(signature[:32])
		y.FillBytes(signature[32:])
		return raw + "." + b64(signature)
	}
	app := &App{Client: server.Client()}
	h := app.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, map[string]any{"userId": UserID(r)}) }))
	for _, tc := range []struct {
		name, path, authorization, apiKey string
		want                              int
		user                              string
	}{
		{"valid JWT", "/api/me", "Bearer " + makeJWT("authenticated"), "", 200, "jwt-user"},
		{"wrong audience", "/api/me", "Bearer " + makeJWT("other"), "", 401, ""},
		{"API key allowed", "/api/bookmarks", "", "bm_example", 200, "api-user"},
		{"API key forbidden", "/api/keys", "", "bm_example", 401, ""},
		{"MCP bearer API key", "/api/mcp", "Bearer bm_example", "", 200, "api-user"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", tc.path, nil)
			if tc.authorization != "" {
				r.Header.Set("Authorization", tc.authorization)
			}
			if tc.apiKey != "" {
				r.Header.Set("X-API-Key", tc.apiKey)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.user != "" {
				var got struct {
					UserID string `json:"userId"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || got.UserID != tc.user {
					t.Fatalf("user=%q err=%v", got.UserID, err)
				}
			}
		})
	}
}
