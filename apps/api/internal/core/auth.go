package core

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
}
type keyCache struct {
	sync.Mutex
	keys                 []jwk
	fetched, lastAttempt time.Time
	refreshing           chan struct{}
}

var remoteKeys keyCache
var errKeySet = errors.New("auth key set unavailable")

func decode64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

func (a *App) jwtUser(ctx context.Context, token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("invalid token")
	}
	hb, e := decode64(parts[0])
	if e != nil {
		return "", e
	}
	pb, e := decode64(parts[1])
	if e != nil {
		return "", e
	}
	sig, e := decode64(parts[2])
	if e != nil {
		return "", e
	}
	var h struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	var c struct {
		Sub string          `json:"sub"`
		Iss string          `json:"iss"`
		Aud json.RawMessage `json:"aud"`
		Exp json.Number     `json:"exp"`
		Nbf json.Number     `json:"nbf"`
	}
	if json.Unmarshal(hb, &h) != nil || json.Unmarshal(pb, &c) != nil || h.Kid == "" || c.Sub == "" {
		return "", errors.New("invalid token")
	}
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	if c.Iss != base+"/auth/v1" {
		return "", errors.New("invalid issuer")
	}
	var audience string
	var audiences []string
	if json.Unmarshal(c.Aud, &audience) != nil {
		_ = json.Unmarshal(c.Aud, &audiences)
	} else {
		audiences = []string{audience}
	}
	validAudience := false
	for _, v := range audiences {
		if v == "authenticated" {
			validAudience = true
		}
	}
	if !validAudience {
		return "", errors.New("invalid audience")
	}
	if c.Exp != "" {
		exp, err := c.Exp.Int64()
		if err != nil || time.Now().Unix() >= exp {
			return "", errors.New("expired token")
		}
	}
	if c.Nbf != "" {
		nbf, err := c.Nbf.Int64()
		if err != nil || time.Now().Unix() < nbf {
			return "", errors.New("premature token")
		}
	}
	key, err := a.jwk(ctx, h.Kid)
	if err != nil {
		return "", err
	}
	if key.Alg != "" && key.Alg != h.Alg {
		return "", errors.New("invalid algorithm")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	switch {
	case h.Alg == "ES256" && key.Kty == "EC" && key.Crv == "P-256":
		x, ex := decode64(key.X)
		y, ey := decode64(key.Y)
		if ex != nil || ey != nil || len(sig) != 64 {
			return "", errors.New("invalid signature")
		}
		pub := ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
		if !pub.Curve.IsOnCurve(pub.X, pub.Y) || !ecdsa.Verify(&pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
			return "", errors.New("invalid signature")
		}
	case h.Alg == "RS256" && key.Kty == "RSA":
		n, en := decode64(key.N)
		b, ee := decode64(key.E)
		if en != nil || ee != nil || len(b) == 0 || len(b) > 4 {
			return "", errors.New("invalid key")
		}
		exponent := 0
		for _, v := range b {
			exponent = exponent<<8 | int(v)
		}
		if exponent < 3 || rsa.VerifyPKCS1v15(&rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}, crypto.SHA256, digest[:], sig) != nil {
			return "", errors.New("invalid signature")
		}
	case h.Alg == "EdDSA" && key.Kty == "OKP" && key.Crv == "Ed25519":
		x, err := decode64(key.X)
		if err != nil || len(x) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(x), []byte(parts[0]+"."+parts[1]), sig) {
			return "", errors.New("invalid signature")
		}
	default:
		return "", errors.New("invalid algorithm")
	}
	return c.Sub, nil
}
func (a *App) jwk(ctx context.Context, kid string) (jwk, error) {
	for {
		remoteKeys.Lock()
		if time.Since(remoteKeys.fetched) < 5*time.Minute {
			for _, key := range remoteKeys.keys {
				if key.Kid == kid {
					remoteKeys.Unlock()
					return key, nil
				}
			}
		}
		if active := remoteKeys.refreshing; active != nil {
			remoteKeys.Unlock()
			select {
			case <-active:
				continue
			case <-ctx.Done():
				return jwk{}, errKeySet
			}
		}
		// Bound fetches for unknown key IDs and outages; a stream of attacker
		// supplied kids must not serialize authentication behind remote I/O.
		if time.Since(remoteKeys.lastAttempt) < 30*time.Second {
			remoteKeys.Unlock()
			return jwk{}, errKeySet
		}
		active := make(chan struct{})
		remoteKeys.refreshing = active
		remoteKeys.lastAttempt = time.Now()
		remoteKeys.Unlock()

		keys, err := a.fetchJWKS(ctx)
		remoteKeys.Lock()
		if err == nil {
			remoteKeys.keys = keys
			remoteKeys.fetched = time.Now()
		}
		remoteKeys.refreshing = nil
		close(active)
		remoteKeys.Unlock()
		if err != nil {
			return jwk{}, errKeySet
		}
		// Loop once through the cache; a missing kid hits the cooldown.
	}
}
func (a *App) fetchJWKS(ctx context.Context) ([]jwk, error) {
	u := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/") + "/auth/v1/.well-known/jwks.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, errKeySet
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&set); err != nil {
		return nil, err
	}
	return set.Keys, nil
}
func HashAPIKey(key string) string {
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:])
}
func (a *App) apiKeyUser(ctx context.Context, key string) (string, error) {
	if os.Getenv("SUPABASE_URL") == "" || os.Getenv("SUPABASE_SECRET_KEY") == "" {
		return "", errors.New("invalid API key")
	}
	hash := HashAPIKey(key)
	q := url.Values{"select": {"user_id,last_used_at"}, "key_hash": {"eq." + hash}, "revoked_at": {"is.null"}, "limit": {"1"}}
	b, status, err := a.DB(ctx, "GET", "api_keys", q, nil, nil)
	if err != nil || status >= 300 {
		return "", errors.New("database error")
	}
	var rows []struct {
		UserID     string     `json:"user_id"`
		LastUsedAt *time.Time `json:"last_used_at"`
	}
	if json.Unmarshal(b, &rows) != nil {
		return "", errors.New("database error")
	}
	if len(rows) == 0 || rows[0].UserID == "" {
		return "", errors.New("invalid API key")
	}
	if rows[0].LastUsedAt == nil || time.Since(*rows[0].LastUsedAt) >= time.Minute {
		q.Del("select")
		q.Del("limit")
		_, status, err = a.DB(ctx, "PATCH", "api_keys", q, map[string]any{"last_used_at": time.Now().UTC().Format(time.RFC3339Nano)}, nil)
		if err != nil || status >= 300 {
			return "", errors.New("database error")
		}
	}
	return rows[0].UserID, nil
}
func (a *App) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/api/health" || p == "/api/health/ready" || r.Method == "OPTIONS" || !strings.HasPrefix(p, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if p == "/api/mcp" && (r.Method == "GET" || r.Method == "DELETE") {
			next.ServeHTTP(w, r)
			return
		}
		var id string
		var err error
		fields := strings.Fields(r.Header.Get("Authorization"))
		bearer := ""
		if len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") {
			bearer = fields[1]
		}
		apiKey := r.Header.Get("X-API-Key")
		if p == "/api/mcp" {
			if apiKey == "" && strings.HasPrefix(bearer, "bm_") {
				apiKey = bearer
			}
			if apiKey == "" {
				Error(w, 401, "UNAUTHORIZED", "Missing API key")
				return
			}
			id, err = a.apiKeyUser(r.Context(), apiKey)
		} else if bearer != "" {
			id, err = a.jwtUser(r.Context(), bearer)
		} else if apiKey != "" && (p == "/api/share" || p == "/api/images" || p == "/api/bookmarks" || strings.HasPrefix(p, "/api/bookmarks/") || p == "/api/categories" || strings.HasPrefix(p, "/api/categories/")) {
			id, err = a.apiKeyUser(r.Context(), apiKey)
		} else {
			Error(w, 401, "UNAUTHORIZED", "Missing bearer token")
			return
		}
		if err != nil {
			if errors.Is(err, errKeySet) {
				Error(w, 502, "INTERNAL", "Unable to verify token: auth key set unavailable")
			} else if err.Error() == "database error" {
				Error(w, 500, "INTERNAL", "Internal server error")
			} else if bearer != "" && p != "/api/mcp" {
				Error(w, 401, "UNAUTHORIZED", "Invalid bearer token")
			} else {
				Error(w, 401, "UNAUTHORIZED", "Invalid API key")
			}
			return
		}
		next.ServeHTTP(w, WithUserID(r, id))
	})
}
