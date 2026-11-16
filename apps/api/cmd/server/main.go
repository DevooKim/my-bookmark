package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"my-bookmark/api/internal/ai"
	"my-bookmark/api/internal/core"
	"my-bookmark/api/internal/data"
	"my-bookmark/api/internal/images"
	"my-bookmark/api/internal/push"
)

func main() {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../../.env")
	port, origin, err := config()
	if err != nil {
		log.Fatal(err)
	}
	app := &core.App{Client: &http.Client{Timeout: 60 * time.Second}}
	app.Categorize = func(ctx context.Context, user, id string) { ai.Categorize(ctx, app, user, id) }
	if os.Getenv("OPEN_ROUTER_API_KEY") != "" {
		app.Embed = func(ctx context.Context, text string) ([]float64, error) { return ai.Embed(ctx, app, text) }
	}
	monitor := core.NewMonitor(app)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { core.JSON(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("GET /api/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ok, checks := monitor.Ready(r.Context(), app)
		status := 200
		if !ok {
			status = 503
		}
		core.JSON(w, status, map[string]any{"ok": ok, "checks": checks})
	})
	if err := push.ValidateConfig(); err != nil {
		log.Fatal(err)
	}
	core.RegisterKeys(mux, app)
	core.RegisterMCP(mux)
	data.Register(mux, app)
	images.Register(mux, app)
	push.Register(mux, app)
	ai.Register(mux, app)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { core.Error(w, 404, "NOT_FOUND", "Route not found") })
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	push.Start(ctx, app)
	handler := monitor.HTTP(security(origin, rejectMalformedJSON(rateLimit(app.Authenticate(mux)))))
	server := &http.Server{Addr: ":" + port, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		if err := server.Shutdown(shutdown); err != nil {
			log.Printf("server shutdown: %v", err)
		}
	}()
	log.Printf("API listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
func config() (string, string, error) {
	mode := os.Getenv("NODE_ENV")
	if mode == "" {
		mode = "development"
	}
	if mode != "development" && mode != "test" && mode != "production" {
		return "", "", errors.New("invalid NODE_ENV")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", "", errors.New("invalid PORT")
	}
	origin := os.Getenv("WEB_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", "", errors.New("invalid WEB_ORIGIN")
	}
	supabase := os.Getenv("SUPABASE_URL")
	if mode != "test" && (supabase == "" || os.Getenv("SUPABASE_SECRET_KEY") == "") {
		return "", "", errors.New("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
	}
	if supabase != "" {
		u, err = url.Parse(supabase)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return "", "", errors.New("invalid SUPABASE_URL")
		}
	}
	if models := strings.TrimSpace(os.Getenv("OPEN_ROUTER_MODELS")); models != "" {
		valid := regexp.MustCompile(`^[\w.-]+/[\w.:-]+$`)
		seen := map[string]bool{}
		count := 0
		for _, item := range strings.Split(models, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if !valid.MatchString(item) || seen[item] {
				return "", "", errors.New("invalid OPEN_ROUTER_MODELS")
			}
			seen[item] = true
			count++
		}
		if count == 0 {
			return "", "", errors.New("invalid OPEN_ROUTER_MODELS")
		}
	}
	return port, origin, nil
}
func security(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Origin-Agent-Cluster", "?1")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-DNS-Prefetch-Control", "off")
		h.Set("X-Download-Options", "noopen")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("X-Permitted-Cross-Domain-Policies", "none")
		h.Set("X-XSS-Protection", "0")
		h.Set("Access-Control-Allow-Origin", origin)
		h.Add("Vary", "Origin")
		if r.Method == "OPTIONS" {
			h.Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
			if v := r.Header.Get("Access-Control-Request-Headers"); v != "" {
				h.Set("Access-Control-Allow-Headers", v)
				h.Add("Vary", "Access-Control-Request-Headers")
			}
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func rejectMalformedJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" || !strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			next.ServeHTTP(w, r)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20+1))
		if err != nil || len(body) > 1<<20 || (len(bytes.TrimSpace(body)) > 0 && !json.Valid(body)) {
			core.Error(w, 400, "VALIDATION_ERROR", "Malformed JSON body")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next.ServeHTTP(w, r)
	})
}

type rateEntry struct {
	count int
	reset time.Time
}

func rateLimit(next http.Handler) http.Handler {
	var mu sync.Mutex
	entries := map[string]rateEntry{}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		limited := p == "/api/share" || strings.HasPrefix(p, "/api/share/") || p == "/api/images" || p == "/api/bookmarks" || strings.HasPrefix(p, "/api/bookmarks/") || p == "/api/categories" || strings.HasPrefix(p, "/api/categories/")
		if !limited || r.Header.Get("X-API-Key") == "" {
			next.ServeHTTP(w, r)
			return
		}
		ip := core.SourceIP(r)
		now := time.Now()
		mu.Lock()
		for key, e := range entries {
			if now.After(e.reset) {
				delete(entries, key)
			}
		}
		e := entries[ip]
		if now.After(e.reset) {
			e = rateEntry{reset: now.Add(time.Minute)}
		}
		e.count++
		entries[ip] = e
		mu.Unlock()
		remaining := 60 - e.count
		if remaining < 0 {
			remaining = 0
		}
		w.Header().Set("RateLimit-Policy", "60;w=60")
		w.Header().Set("RateLimit-Limit", "60")
		w.Header().Set("RateLimit-Remaining", strconv.Itoa(remaining))
		seconds := int(time.Until(e.reset).Seconds()) + 1
		w.Header().Set("RateLimit-Reset", strconv.Itoa(seconds))
		if e.count > 60 {
			w.Header().Set("Retry-After", strconv.Itoa(seconds))
			core.Error(w, 429, "RATE_LIMITED", "Too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}
