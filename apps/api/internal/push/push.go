package push

import (
	"bytes"
	"context"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"my-bookmark/api/internal/core"
)

type subscription struct {
	ID       string `json:"id"`
	Endpoint string `json:"endpoint"`
	P256DH   string `json:"p256dh"`
	Auth     string `json:"auth"`
}
type payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

// ValidateConfig rejects invalid complete VAPID configuration. Partial
// configuration intentionally disables push, matching the original service.
func ValidateConfig() error {
	if !configured() {
		return nil
	}
	public, err := base64.RawURLEncoding.DecodeString(os.Getenv("VAPID_PUBLIC_KEY"))
	if err != nil || len(public) != 65 {
		return fmt.Errorf("invalid VAPID public key")
	}
	curve := elliptic.P256()
	x, y := elliptic.Unmarshal(curve, public)
	if x == nil {
		return fmt.Errorf("invalid VAPID public key")
	}
	private, err := base64.RawURLEncoding.DecodeString(os.Getenv("VAPID_PRIVATE_KEY"))
	if err != nil || len(private) != 32 {
		return fmt.Errorf("invalid VAPID private key")
	}
	scalar := new(big.Int).SetBytes(private)
	if scalar.Sign() == 0 || scalar.Cmp(curve.Params().N) >= 0 {
		return fmt.Errorf("invalid VAPID private key")
	}
	px, py := curve.ScalarBaseMult(private)
	if !bytes.Equal(elliptic.Marshal(curve, px, py), elliptic.Marshal(curve, x, y)) {
		return fmt.Errorf("VAPID keys do not match")
	}
	subject, err := url.Parse(os.Getenv("VAPID_SUBJECT"))
	if err != nil || subject == nil || (subject.Scheme != "https" && subject.Scheme != "mailto") || (subject.Scheme == "https" && subject.Hostname() == "") {
		return fmt.Errorf("invalid VAPID subject")
	}
	return nil
}
func configured() bool {
	return os.Getenv("VAPID_PUBLIC_KEY") != "" && os.Getenv("VAPID_PRIVATE_KEY") != "" && os.Getenv("VAPID_SUBJECT") != ""
}
func origin() string {
	if s := os.Getenv("WEB_ORIGIN"); s != "" {
		return s
	}
	return "http://localhost:3000"
}
func db(ctx context.Context, a *core.App, method, path string, q url.Values, body any, prefer string) ([]byte, error) {
	h := http.Header{}
	if prefer != "" {
		h.Set("Prefer", prefer)
	}
	b, status, err := a.DB(ctx, method, path, q, body, h)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("database returned %d: %s", status, b)
	}
	return b, nil
}
func dbError(w http.ResponseWriter, err error) {
	log.Printf("push/reminder database error: %v", err)
	core.Error(w, 500, "INTERNAL", "Internal server error")
}
func validation(w http.ResponseWriter, msg string) { core.Error(w, 400, "VALIDATION_ERROR", msg) }
func validURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && u.IsAbs() && (u.Host != "" || u.Opaque != "")
}
func subscriptions(ctx context.Context, a *core.App, user string) ([]subscription, error) {
	b, e := db(ctx, a, "GET", "push_subscriptions", url.Values{"select": {"id,endpoint,p256dh,auth"}, "user_id": {"eq." + user}}, nil, "")
	if e != nil {
		return nil, e
	}
	var rows []subscription
	e = json.Unmarshal(b, &rows)
	return rows, e
}
func send(ctx context.Context, a *core.App, s subscription, p payload) (bool, bool, error) {
	b, e := json.Marshal(p)
	if e != nil {
		return false, false, e
	}
	opts := &webpush.Options{Subscriber: strings.TrimPrefix(os.Getenv("VAPID_SUBJECT"), "mailto:"), VAPIDPublicKey: os.Getenv("VAPID_PUBLIC_KEY"), VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"), TTL: 2419200}
	if a.Client != nil {
		opts.HTTPClient = a.Client
	}
	response, e := webpush.SendNotificationWithContext(ctx, b, &webpush.Subscription{Endpoint: s.Endpoint, Keys: webpush.Keys{P256dh: s.P256DH, Auth: s.Auth}}, opts)
	if e != nil {
		log.Printf("push send failed: %v", e)
		return false, false, nil
	}
	defer response.Body.Close()
	if response.StatusCode == 404 || response.StatusCode == 410 {
		_, e = db(ctx, a, "DELETE", "push_subscriptions", url.Values{"id": {"eq." + s.ID}}, nil, "")
		return false, true, e
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		log.Printf("push send failed: HTTP %d", response.StatusCode)
		return false, false, nil
	}
	return true, false, nil
}
func Register(mux *http.ServeMux, a *core.App) {
	mux.HandleFunc("GET /api/push/status", func(w http.ResponseWriter, r *http.Request) {
		rows, e := subscriptions(r.Context(), a, core.UserID(r))
		if e != nil {
			dbError(w, e)
			return
		}
		var key any
		if s := os.Getenv("VAPID_PUBLIC_KEY"); s != "" {
			key = s
		}
		core.JSON(w, 200, map[string]any{"enabled": len(rows) > 0, "subscriptionCount": len(rows), "vapidPublicKey": key})
	})
	mux.HandleFunc("POST /api/push/subscriptions", func(w http.ResponseWriter, r *http.Request) {
		if !configured() || ValidateConfig() != nil {
			core.Error(w, 500, "INTERNAL", "Push is not configured")
			return
		}
		var input struct {
			Endpoint string `json:"endpoint"`
			Keys     struct {
				P256DH string `json:"p256dh"`
				Auth   string `json:"auth"`
			} `json:"keys"`
		}
		if core.Decode(r, &input) != nil || !validURL(input.Endpoint) || input.Keys.P256DH == "" || input.Keys.Auth == "" {
			validation(w, "Invalid request body")
			return
		}
		var ua any
		if s := r.Header.Get("User-Agent"); s != "" {
			ua = s
		}
		_, e := db(r.Context(), a, "POST", "push_subscriptions", url.Values{"on_conflict": {"endpoint"}}, map[string]any{"user_id": core.UserID(r), "endpoint": input.Endpoint, "p256dh": input.Keys.P256DH, "auth": input.Keys.Auth, "user_agent": ua}, "resolution=merge-duplicates")
		if e != nil {
			dbError(w, e)
			return
		}
		w.WriteHeader(201)
	})
	mux.HandleFunc("POST /api/push/unsubscribe", func(w http.ResponseWriter, r *http.Request) {
		var input map[string]json.RawMessage
		err := core.Decode(r, &input)
		if err != nil && err != io.EOF {
			validation(w, "Invalid request body")
			return
		}
		q := url.Values{"user_id": {"eq." + core.UserID(r)}}
		if v, ok := input["endpoint"]; ok {
			var endpoint string
			if string(v) == "null" || json.Unmarshal(v, &endpoint) != nil || !validURL(endpoint) {
				validation(w, "Invalid request body")
				return
			}
			q.Set("endpoint", "eq."+endpoint)
		}
		if v, ok := input["keys"]; ok {
			var keys struct {
				P256DH string `json:"p256dh"`
				Auth   string `json:"auth"`
			}
			if string(v) == "null" || json.Unmarshal(v, &keys) != nil || keys.P256DH == "" || keys.Auth == "" {
				validation(w, "Invalid request body")
				return
			}
		}
		_, e := db(r.Context(), a, "DELETE", "push_subscriptions", q, nil, "")
		if e != nil {
			dbError(w, e)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("POST /api/push/test", func(w http.ResponseWriter, r *http.Request) {
		if !configured() || ValidateConfig() != nil {
			core.Error(w, 500, "INTERNAL", "Push is not configured")
			return
		}
		rows, e := subscriptions(r.Context(), a, core.UserID(r))
		if e != nil {
			dbError(w, e)
			return
		}
		sent, failed := 0, 0
		for _, s := range rows {
			ok, _, err := send(r.Context(), a, s, payload{Title: "🔖 테스트 알림", Body: "My Bookmark 푸시 알림이 정상 동작합니다.", URL: origin()})
			if err != nil {
				dbError(w, err)
				return
			}
			if ok {
				sent++
			} else {
				failed++
			}
		}
		core.JSON(w, 200, map[string]int{"sent": sent, "failed": failed})
	})
	registerReminders(mux, a)
}
func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
