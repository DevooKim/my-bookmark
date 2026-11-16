package push

import (
	"context"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"my-bookmark/api/internal/core"
)

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	result, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestNextReminderCalendarAndTimezones(t *testing.T) {
	day := 31
	cases := []struct {
		name, scheduled, recurrence, zone, now, want string
		day                                          *int
	}{
		{"daily DST", "2026-03-07T14:00:00Z", "daily", "America/New_York", "2026-03-07T15:00:00Z", "2026-03-08T13:00:00Z", nil},
		{"weekly DST", "2026-03-01T14:00:00Z", "weekly", "America/New_York", "2026-03-01T15:00:00Z", "2026-03-08T13:00:00Z", nil},
		{"monthly clamps", "2026-01-31T12:00:00Z", "monthly", "UTC", "2026-02-01T00:00:00Z", "2026-02-28T12:00:00Z", &day},
		{"monthly restores anchor", "2026-02-28T12:00:00Z", "monthly", "UTC", "2026-03-01T00:00:00Z", "2026-03-31T12:00:00Z", &day},
		{"skips missed occurrences", "2026-01-01T12:00:00Z", "daily", "UTC", "2026-01-04T12:00:00Z", "2026-01-05T12:00:00Z", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			loc, err := time.LoadLocation(tc.zone)
			if err != nil {
				t.Fatal(err)
			}
			got, err := nextReminder(mustTime(t, tc.scheduled), tc.recurrence, loc, mustTime(t, tc.now), tc.day)
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(mustTime(t, tc.want)) {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func configureTestPush(t *testing.T) (string, string) {
	t.Helper()
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("VAPID_PRIVATE_KEY", private)
	t.Setenv("VAPID_PUBLIC_KEY", public)
	t.Setenv("VAPID_SUBJECT", "https://example.com/contact")
	_, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	p256 := base64.RawURLEncoding.EncodeToString(elliptic.Marshal(elliptic.P256(), x, y))
	auth := base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef"))
	return p256, auth
}

func TestValidateConfigAndSchedulerGuard(t *testing.T) {
	configureTestPush(t)
	if err := ValidateConfig(); err != nil {
		t.Fatalf("valid configuration rejected: %v", err)
	}
	t.Run("missing configuration disables push", func(t *testing.T) {
		t.Setenv("VAPID_PUBLIC_KEY", "")
		if err := ValidateConfig(); err != nil {
			t.Fatalf("partial configuration: %v", err)
		}
	})
	cases := []struct{ name, key, value string }{
		{"bad public key", "VAPID_PUBLIC_KEY", "invalid"},
		{"bad private key", "VAPID_PRIVATE_KEY", "invalid"},
		{"invalid private scalar", "VAPID_PRIVATE_KEY", base64.RawURLEncoding.EncodeToString(make([]byte, 32))},
		{"bad subject", "VAPID_SUBJECT", "http://example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			t.Setenv("NODE_ENV", "production")
			if err := ValidateConfig(); err == nil {
				t.Fatal("invalid configuration accepted")
			}
			started := false
			Start(context.Background(), &core.App{CronStarted: func() { started = true }})
			if started {
				t.Error("scheduler started with invalid configuration")
			}
		})
	}
	t.Run("mailto subject", func(t *testing.T) {
		t.Setenv("VAPID_SUBJECT", "mailto:admin@example.com")
		if err := ValidateConfig(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestProcessDueClaimsAndContinuesAfterPushFailures(t *testing.T) {
	p256, auth := configureTestPush(t)
	now := mustTime(t, "2026-04-10T12:00:00Z")
	sent := []string{}
	deleted := ""
	claimCount := 0
	subscriptionQueries := 0
	pushServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent = append(sent, r.URL.Path)
		if r.Header.Get("Content-Encoding") != "aes128gcm" || !strings.HasPrefix(r.Header.Get("Authorization"), "vapid ") {
			t.Errorf("missing encrypted push or VAPID headers")
		}
		switch r.URL.Path {
		case "/failure":
			w.WriteHeader(503)
		case "/expired":
			w.WriteHeader(410)
		default:
			w.WriteHeader(201)
		}
	}))
	defer pushServer.Close()
	dbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/rest/v1/reminders":
			q := r.URL.Query()
			if q.Get("status") != "eq.pending" || q.Get("is_enabled") != "eq.true" || q.Get("remind_at") != "lte."+iso(now) || q.Get("limit") != "20" {
				t.Errorf("incorrect due filter: %v", q)
			}
			fmt.Fprint(w, `[{"id":"first","user_id":"user-a","remind_at":"2026-04-10T11:00:00Z","recurrence":"daily","recurrence_timezone":"UTC","bookmarks":{"id":"b","kind":"link","url":"https://example.com","title":"Title"}},{"id":"second","user_id":"user-b","remind_at":"2026-04-10T10:00:00Z","recurrence":"none","recurrence_timezone":"UTC","bookmarks":{"id":"b","kind":"link","url":"https://example.com","title":null}}]`)
		case r.Method == "PATCH" && r.URL.Path == "/rest/v1/reminders":
			claimCount++
			q := r.URL.Query()
			if q.Get("status") != "eq.pending" || q.Get("is_enabled") != "eq.true" || q.Get("remind_at") == "" {
				t.Errorf("claim lacks compare-and-swap filters: %v", q)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if q.Get("id") == "eq.first" {
				if body["status"] != "pending" || body["remind_at"] != "2026-04-11T11:00:00.000Z" || body["sent_at"] != iso(now) {
					t.Errorf("incorrect recurring claim: %v", body)
				}
				fmt.Fprint(w, `[{"id":"first"}]`)
			} else {
				if body["status"] != "sent" || body["sent_at"] != iso(now) {
					t.Errorf("incorrect one-time claim: %v", body)
				}
				fmt.Fprint(w, `[]`)
			}
		case r.Method == "GET" && r.URL.Path == "/rest/v1/push_subscriptions":
			subscriptionQueries++
			if r.URL.Query().Get("user_id") != "eq.user-a" {
				t.Errorf("incorrect subscription user: %v", r.URL.Query())
			}
			_ = json.NewEncoder(w).Encode([]subscription{{ID: "failure", Endpoint: pushServer.URL + "/failure", P256DH: p256, Auth: auth}, {ID: "expired", Endpoint: pushServer.URL + "/expired", P256DH: p256, Auth: auth}, {ID: "success", Endpoint: pushServer.URL + "/success", P256DH: p256, Auth: auth}})
		case r.Method == "DELETE" && r.URL.Path == "/rest/v1/push_subscriptions":
			deleted = r.URL.Query().Get("id")
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected database request: %s %s", r.Method, r.URL)
			w.WriteHeader(500)
		}
	}))
	defer dbServer.Close()
	t.Setenv("SUPABASE_URL", dbServer.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "secret")
	stats, err := processDue(context.Background(), &core.App{}, now)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Scanned != 2 || stats.Claimed != 1 || stats.Sent != 1 || stats.Failed != 1 || stats.Expired != 1 {
		t.Errorf("incorrect statistics: %+v", stats)
	}
	if claimCount != 2 || subscriptionQueries != 1 || strings.Join(sent, ",") != "/failure,/expired,/success" || deleted != "eq.expired" {
		t.Errorf("claims=%d subscription queries=%d sends=%v deleted=%q", claimCount, subscriptionQueries, sent, deleted)
	}
}

func TestRoutesScopeQueriesToUser(t *testing.T) {
	const user = "11111111-1111-4111-8111-111111111111"
	const reminderID = "22222222-2222-4222-8222-222222222222"
	const bookmarkID = "33333333-3333-4333-8333-333333333333"
	calls := 0
	dbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if got := r.URL.Query().Get("user_id"); got != "eq."+user {
			t.Errorf("unscoped %s %s: %q", r.Method, r.URL.Path, got)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "DELETE" || (r.Method == "PATCH" && r.Header.Get("Prefer") != "return=representation") {
			w.WriteHeader(204)
			return
		}
		fmt.Fprint(w, `[]`)
	}))
	defer dbServer.Close()
	t.Setenv("SUPABASE_URL", dbServer.URL)
	t.Setenv("SUPABASE_SECRET_KEY", "secret")
	mux := http.NewServeMux()
	Register(mux, &core.App{})
	cases := []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/push/status", "", 200},
		{"POST", "/api/push/unsubscribe", `{"endpoint":"https://push.example/sub"}`, 204},
		{"GET", "/api/reminders", "", 200},
		{"DELETE", "/api/reminders/" + reminderID, "", 204},
		{"POST", "/api/reminders", fmt.Sprintf(`{"bookmarkId":%q,"remindAt":"2099-01-01T00:00:00Z","recurrence":"none","recurrenceTimezone":"UTC"}`, bookmarkID), 400},
		{"PATCH", "/api/reminders/" + reminderID, `{"note":"changed"}`, 404},
		{"POST", "/api/reminders/" + reminderID + "/reschedule", `{"remindAt":"2099-01-01T00:00:00Z","recurrence":"none","recurrenceTimezone":"UTC"}`, 404},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r = core.WithUserID(r, user)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Errorf("got status %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
	if calls != len(cases) {
		t.Errorf("got %d database requests, want %d", calls, len(cases))
	}
}
