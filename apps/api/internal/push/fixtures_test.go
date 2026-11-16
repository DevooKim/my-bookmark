package push

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/hkdf"
	"my-bookmark/api/internal/core"
)

type pushReceiver struct {
	private []byte
	public  []byte
	auth    []byte
}

func newPushReceiver(t *testing.T) pushReceiver {
	t.Helper()
	private, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatal(err)
	}
	return pushReceiver{private: private, public: elliptic.Marshal(elliptic.P256(), x, y), auth: auth}
}

func (receiver pushReceiver) subscription(id, endpoint string) subscription {
	return subscription{ID: id, Endpoint: endpoint, P256DH: base64.RawURLEncoding.EncodeToString(receiver.public), Auth: base64.RawURLEncoding.EncodeToString(receiver.auth)}
}

// decryptPush independently acts as the browser: it derives the RFC 8291
// keys from the receiver's private key and authenticates the encrypted record.
func (receiver pushReceiver) decryptPush(r *http.Request) (payload, error) {
	var result payload
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return result, err
	}
	if len(body) < 21 || binary.BigEndian.Uint32(body[16:20]) != 4096 {
		return result, fmt.Errorf("invalid aes128gcm record header")
	}
	keyLen := int(body[20])
	if keyLen != 65 || len(body) <= 21+keyLen {
		return result, fmt.Errorf("invalid server public key length")
	}
	serverKey := body[21 : 21+keyLen]
	x, y := elliptic.Unmarshal(elliptic.P256(), serverKey)
	if x == nil {
		return result, fmt.Errorf("invalid server public key")
	}
	sharedX, _ := elliptic.P256().ScalarMult(x, y, receiver.private)
	shared := sharedX.FillBytes(make([]byte, 32))
	info := append([]byte("WebPush: info\x00"), receiver.public...)
	info = append(info, serverKey...)
	derive := func(secret, salt, info []byte, n int) ([]byte, error) {
		out := make([]byte, n)
		_, err := io.ReadFull(hkdf.New(sha256.New, secret, salt, info), out)
		return out, err
	}
	ikm, err := derive(shared, receiver.auth, info, 32)
	if err != nil {
		return result, err
	}
	key, err := derive(ikm, body[:16], []byte("Content-Encoding: aes128gcm\x00"), 16)
	if err != nil {
		return result, err
	}
	nonce, err := derive(ikm, body[:16], []byte("Content-Encoding: nonce\x00"), 12)
	if err != nil {
		return result, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return result, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return result, err
	}
	plain, err := gcm.Open(nil, nonce, body[21+keyLen:], nil)
	if err != nil {
		return result, err
	}
	plain = bytes.TrimRight(plain, "\x00")
	if len(plain) == 0 || plain[len(plain)-1] != 2 {
		return result, fmt.Errorf("missing final record delimiter")
	}
	if err := json.Unmarshal(plain[:len(plain)-1], &result); err != nil {
		return result, err
	}
	return result, nil
}

func verifyVAPID(r *http.Request, audience, subject, public string) error {
	header := r.Header.Get("Authorization")
	parts := strings.Split(strings.TrimPrefix(header, "vapid "), ", ")
	if !strings.HasPrefix(header, "vapid ") || len(parts) != 2 || !strings.HasPrefix(parts[0], "t=") || parts[1] != "k="+public {
		return fmt.Errorf("invalid VAPID authorization header")
	}
	encoded, err := base64.RawURLEncoding.DecodeString(public)
	if err != nil {
		return err
	}
	x, y := elliptic.Unmarshal(elliptic.P256(), encoded)
	if x == nil {
		return fmt.Errorf("invalid VAPID public key")
	}
	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(strings.TrimPrefix(parts[0], "t="), claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodES256 {
			return nil, fmt.Errorf("unexpected VAPID signing algorithm %s", token.Method.Alg())
		}
		return &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, nil
	}, jwt.WithAudience(audience), jwt.WithExpirationRequired())
	if err != nil {
		return err
	}
	if claims["sub"] != subject {
		return fmt.Errorf("VAPID subject %v, want %s", claims["sub"], subject)
	}
	return nil
}

func TestProcessDueMultiUserEncryptedDelivery(t *testing.T) {
	configureTestPush(t)
	t.Setenv("VAPID_SUBJECT", "mailto:push@example.com")
	t.Setenv("WEB_ORIGIN", "https://bookmarks.example")
	now := mustTime(t, "2026-03-08T14:00:00Z")
	receivers := map[string]pushReceiver{"/a": newPushReceiver(t), "/b": newPushReceiver(t)}
	want := map[string]payload{
		"/a": {Title: "🔖 Article", Body: "Read it", URL: "https://www.example.com/article"},
		"/b": {Title: "🔖 이미지", Body: "이미지", URL: "https://bookmarks.example/images/image-b"},
	}
	var mu sync.Mutex
	delivered := map[string]int{}
	claims := map[string]bool{}
	subscriptionUsers := map[string]int{}
	var pushServer *httptest.Server
	pushServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receiver, ok := receivers[r.URL.Path]
		if !ok {
			t.Errorf("unexpected push endpoint %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		if r.Method != "POST" || r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("Content-Type") != "application/octet-stream" || r.Header.Get("TTL") != "2419200" {
			t.Errorf("invalid push request: %s %v", r.Method, r.Header)
		}
		if err := verifyVAPID(r, pushServer.URL, "mailto:push@example.com", os.Getenv("VAPID_PUBLIC_KEY")); err != nil {
			t.Errorf("invalid VAPID token: %v", err)
		}
		got, err := receiver.decryptPush(r)
		if err != nil || got != want[r.URL.Path] {
			t.Errorf("decrypted %s: got %+v, err %v; want %+v", r.URL.Path, got, err, want[r.URL.Path])
		}
		mu.Lock()
		delivered[r.URL.Path]++
		mu.Unlock()
		w.WriteHeader(201)
	}))
	defer pushServer.Close()
	dbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		q := r.URL.Query()
		switch {
		case r.Method == "GET" && r.URL.Path == "/rest/v1/reminders":
			if q.Get("status") != "eq.pending" || q.Get("is_enabled") != "eq.true" || q.Get("remind_at") != "lte."+iso(now) || q.Get("order") != "remind_at.asc" || q.Get("limit") != "20" {
				t.Errorf("incorrect due query: %v", q)
			}
			fmt.Fprint(w, `[{"id":"a","user_id":"user-a","remind_at":"2026-03-07T14:00:00Z","note":"Read it","recurrence":"daily","recurrence_timezone":"America/New_York","bookmarks":{"id":"link-a","kind":"link","url":"https://www.example.com/article","title":"Article"}},{"id":"b","user_id":"user-b","remind_at":"2026-03-08T13:00:00Z","recurrence":"none","recurrence_timezone":"UTC","bookmarks":[{"id":"image-b","kind":"image","url":null,"title":null}]},{"id":"race","user_id":"user-c","remind_at":"2026-03-08T13:30:00Z","recurrence":"none","recurrence_timezone":"UTC","bookmarks":{"id":"image-c","kind":"image"}}]`)
		case r.Method == "PATCH" && r.URL.Path == "/rest/v1/reminders":
			id := strings.TrimPrefix(q.Get("id"), "eq.")
			expectedAt := map[string]string{"a": "2026-03-07T14:00:00Z", "b": "2026-03-08T13:00:00Z", "race": "2026-03-08T13:30:00Z"}[id]
			if expectedAt == "" || q.Get("status") != "eq.pending" || q.Get("is_enabled") != "eq.true" || q.Get("remind_at") != "eq."+expectedAt || q.Get("select") != "id" || r.Header.Get("Prefer") != "return=representation" {
				t.Errorf("invalid claim: %v headers %v", q, r.Header)
			}
			var update map[string]any
			if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
				t.Error(err)
			}
			if update["sent_at"] != iso(now) {
				t.Errorf("claim timestamp: %v", update)
			}
			if id == "a" {
				if update["status"] != "pending" || update["remind_at"] != "2026-03-09T13:00:00.000Z" {
					t.Errorf("DST recurrence claim: %v", update)
				}
			} else if update["status"] != "sent" || len(update) != 2 {
				t.Errorf("one-time claim: %v", update)
			}
			if id == "race" {
				fmt.Fprint(w, `[]`)
			} else {
				claims[id] = true
				fmt.Fprintf(w, `[{"id":%q}]`, id)
			}
		case r.Method == "GET" && r.URL.Path == "/rest/v1/push_subscriptions":
			user := q.Get("user_id")
			id := map[string]string{"eq.user-a": "a", "eq.user-b": "b"}[user]
			if id == "" || !claims[id] {
				t.Errorf("subscriptions queried for unclaimed or wrong user %q", user)
				w.WriteHeader(500)
				return
			}
			subscriptionUsers[user]++
			_ = json.NewEncoder(w).Encode([]subscription{receivers["/"+id].subscription(id, pushServer.URL+"/"+id)})
		default:
			t.Errorf("unexpected database request %s %s", r.Method, r.URL)
			w.WriteHeader(500)
		}
	}))
	defer dbServer.Close()
	t.Setenv("SUPABASE_URL", dbServer.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "fixture-secret")
	stats, err := processDue(context.Background(), &core.App{}, now)
	if err != nil {
		t.Fatal(err)
	}
	if stats != (core.CronStats{Scanned: 3, Claimed: 2, Sent: 2}) {
		t.Errorf("unexpected cron stats: %+v", stats)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(claims) != 2 || subscriptionUsers["eq.user-a"] != 1 || subscriptionUsers["eq.user-b"] != 1 || len(subscriptionUsers) != 2 || delivered["/a"] != 1 || delivered["/b"] != 1 || len(delivered) != 2 {
		t.Errorf("claims %v, subscription users %v, deliveries %v", claims, subscriptionUsers, delivered)
	}
}

func TestSendExpiredAndFailedSubscriptionFixtures(t *testing.T) {
	configureTestPush(t)
	receiver := newPushReceiver(t)
	var mu sync.Mutex
	deleted := []string{}
	failDelete := false
	dbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method != "DELETE" || r.URL.Path != "/rest/v1/push_subscriptions" {
			t.Errorf("unexpected database request %s %s", r.Method, r.URL)
			w.WriteHeader(500)
			return
		}
		deleted = append(deleted, r.URL.Query().Get("id"))
		if failDelete {
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(204)
	}))
	defer dbServer.Close()
	pushServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gone":
			w.WriteHeader(410)
		case "/not-found":
			w.WriteHeader(404)
		case "/unavailable":
			w.WriteHeader(503)
		default:
			w.WriteHeader(201)
		}
	}))
	defer pushServer.Close()
	t.Setenv("SUPABASE_URL", dbServer.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "fixture-secret")
	for _, tc := range []struct {
		name, path  string
		ok, expired bool
	}{
		{"success", "/ok", true, false},
		{"gone", "/gone", false, true},
		{"not found", "/not-found", false, true},
		{"temporary failure", "/unavailable", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ok, expired, err := send(context.Background(), &core.App{}, receiver.subscription(tc.name, pushServer.URL+tc.path), payload{Title: "fixture"})
			if err != nil || ok != tc.ok || expired != tc.expired {
				t.Errorf("got ok=%v expired=%v err=%v", ok, expired, err)
			}
		})
	}
	mu.Lock()
	if len(deleted) != 2 || deleted[0] != "eq.gone" || deleted[1] != "eq.not found" {
		t.Errorf("unexpected deleted subscriptions: %v", deleted)
	}
	failDelete = true
	mu.Unlock()
	ok, expired, err := send(context.Background(), &core.App{}, receiver.subscription("delete-fails", pushServer.URL+"/gone"), payload{Title: "fixture"})
	if ok || !expired || err == nil {
		t.Errorf("failed expiration cleanup: ok=%v expired=%v err=%v", ok, expired, err)
	}
}

func TestPushRoutesIsolateMultipleUsers(t *testing.T) {
	configureTestPush(t)
	receiver := newPushReceiver(t)
	var mu sync.Mutex
	delivered := map[string]int{}
	pushServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		delivered[r.URL.Path]++
		mu.Unlock()
		w.WriteHeader(201)
	}))
	defer pushServer.Close()
	rows := map[string][]subscription{
		"user-a": {receiver.subscription("a", pushServer.URL+"/a")},
		"user-b": {receiver.subscription("b", pushServer.URL+"/b")},
	}
	dbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path != "/rest/v1/push_subscriptions" {
			t.Errorf("unexpected database path %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		userFilter := r.URL.Query().Get("user_id")
		if !strings.HasPrefix(userFilter, "eq.user-") {
			t.Errorf("missing user scope: %v", r.URL.Query())
			w.WriteHeader(500)
			return
		}
		user := strings.TrimPrefix(userFilter, "eq.")
		switch r.Method {
		case "GET":
			w.Header().Set("Content-Type", "application/json")
			result := rows[user]
			if result == nil {
				result = []subscription{}
			}
			_ = json.NewEncoder(w).Encode(result)
		case "DELETE":
			endpoint := strings.TrimPrefix(r.URL.Query().Get("endpoint"), "eq.")
			kept := []subscription{}
			for _, row := range rows[user] {
				if endpoint != "" && row.Endpoint != endpoint {
					kept = append(kept, row)
				}
			}
			rows[user] = kept
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected database method %s", r.Method)
			w.WriteHeader(500)
		}
	}))
	defer dbServer.Close()
	t.Setenv("SUPABASE_URL", dbServer.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "fixture-secret")
	mux := http.NewServeMux()
	Register(mux, &core.App{})
	request := func(user, method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := core.WithUserID(httptest.NewRequest(method, path, strings.NewReader(body)), user)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, req)
		if response.Code != status {
			t.Fatalf("%s %s as %s: status %d, body %s", method, path, user, response.Code, response.Body.String())
		}
		return response
	}
	status := func(user string, enabled bool, count int) {
		t.Helper()
		response := request(user, "GET", "/api/push/status", "", 200)
		var got struct {
			Enabled bool   `json:"enabled"`
			Count   int    `json:"subscriptionCount"`
			Key     string `json:"vapidPublicKey"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil || got.Enabled != enabled || got.Count != count || got.Key != os.Getenv("VAPID_PUBLIC_KEY") {
			t.Errorf("status for %s: %+v, err %v", user, got, err)
		}
	}
	status("user-a", true, 1)
	status("user-b", true, 1)
	// An endpoint belonging to another user must not remove that subscription.
	request("user-a", "POST", "/api/push/unsubscribe", fmt.Sprintf(`{"endpoint":%q}`, pushServer.URL+"/b"), 204)
	status("user-b", true, 1)
	response := request("user-b", "POST", "/api/push/test", "", 200)
	var result struct {
		Sent   int `json:"sent"`
		Failed int `json:"failed"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Sent != 1 || result.Failed != 0 {
		t.Errorf("test push response: %+v, err %v", result, err)
	}
	request("user-a", "POST", "/api/push/unsubscribe", `{}`, 204)
	status("user-a", false, 0)
	status("user-b", true, 1)
	mu.Lock()
	defer mu.Unlock()
	if delivered["/b"] != 1 || len(delivered) != 1 || len(rows["user-a"]) != 0 || len(rows["user-b"]) != 1 {
		t.Errorf("cross-user effects: deliveries %v, subscriptions %v", delivered, rows)
	}
}
