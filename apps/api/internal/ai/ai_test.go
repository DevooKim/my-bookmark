package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"my-bookmark/api/internal/core"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}
func testApp(t *testing.T, f roundTripFunc) *core.App {
	t.Helper()
	t.Setenv("SUPABASE_URL", "https://database.example")
	t.Setenv("SUPABASE_SECRET_KEY", "secret")
	return &core.App{Client: &http.Client{Transport: f}}
}

func TestApplyDoesNotOverwriteManualEditOrReplacePlaces(t *testing.T) {
	calls := 0
	app := testApp(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "PATCH" || r.URL.Path != "/rest/v1/bookmarks" {
			t.Errorf("unexpected database call %s %s", r.Method, r.URL.Path)
			return response(500, "{}"), nil
		}
		q := r.URL.Query()
		if q.Get("user_id") != "eq.user-1" || q.Get("id") != "eq.bookmark-1" || q.Get("ai_status") != "eq.pending" {
			t.Errorf("unsafe update filter: %s", r.URL.RawQuery)
		}
		if r.Header.Get("Prefer") != "return=representation" {
			t.Errorf("missing return representation: %v", r.Header)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["ai_status"] != "done" {
			t.Errorf("wrong state: %v", body)
		}
		return response(200, "[]"), nil
	})
	var result analysis
	result.Category.Type = "none"
	result.Title = "Summary"
	result.Tags = []string{"one", "two"}
	result.Places = []place{{Name: "Place", Confidence: 0.99}}
	if err := apply(context.Background(), app, "user-1", "bookmark-1", bookmark{}, nil, result, "google/model"); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("got %d calls; place writes must not follow a lost state transition", calls)
	}
}

func TestCategorizeRecordsProviderFailureAndMarksOnlyPending(t *testing.T) {
	t.Setenv("OPEN_ROUTER_API_KEY", "api-key")
	var gotUsage, gotFailed bool
	var observed []bool
	app := testApp(t, func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "openrouter.ai":
			if r.URL.Path != "/api/v1/chat/completions" {
				t.Errorf("unexpected upstream path %s", r.URL.Path)
			}
			return response(429, `{"error":"rate limited"}`), nil
		case r.URL.Path == "/rest/v1/bookmarks" && r.Method == "GET":
			return response(200, `[{"kind":"link","url":"http://127.0.0.1/private","title":"Saved","description":null,"site_name":null,"metadata":{},"ai_status":"pending"}]`), nil
		case r.URL.Path == "/rest/v1/categories" && r.Method == "GET":
			return response(200, `[]`), nil
		case r.URL.Path == "/rest/v1/ai_usage_events" && r.Method == "POST":
			var v map[string]any
			if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
				t.Fatal(err)
			}
			if v["user_id"] != "user-1" || v["bookmark_id"] != "bookmark-1" || v["status"] != "failed" || v["provider"] != "openrouter" || v["model"] != preset || v["error_code"] != "429" || v["is_byok"] != nil {
				t.Errorf("wrong usage event: %#v", v)
			}
			gotUsage = true
			return response(201, ``), nil
		case r.URL.Path == "/rest/v1/bookmarks" && r.Method == "PATCH":
			if r.URL.Query().Get("user_id") != "eq.user-1" || r.URL.Query().Get("id") != "eq.bookmark-1" || r.URL.Query().Get("ai_status") != "eq.pending" {
				t.Errorf("unsafe bookmark update: %s", r.URL.RawQuery)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["ai_status"] == "failed" {
				gotFailed = true
			}
			return response(204, ``), nil
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			return response(500, ``), nil
		}
	})
	app.AIUsage = func(success bool) { observed = append(observed, success) }
	Categorize(context.Background(), app, "user-1", "bookmark-1")
	if !gotUsage || !gotFailed {
		t.Fatalf("usage recorded=%v failed state recorded=%v", gotUsage, gotFailed)
	}
	if len(observed) != 1 || observed[0] {
		t.Fatalf("unexpected monitoring events: %v", observed)
	}
}

func TestUsageRecordingFailureIsNonFatal(t *testing.T) {
	var notified bool
	app := testApp(t, func(r *http.Request) (*http.Response, error) { return response(500, `{"message":"unavailable"}`), nil })
	app.AIUsage = func(ok bool) { notified = ok }
	record(context.Background(), app, "user", "bookmark", "google", "google/model", "success", nil, 12, nil)
	if !notified {
		t.Fatal("successful event did not notify monitoring")
	}
}

func TestAnalysisValidationAndPlaceFiltering(t *testing.T) {
	valid := `{"category":{"type":"none"},"summaryTitle":" ` + strings.Repeat("👨‍👩‍👧‍👦", 41) + ` ","summary":" summary ","tags":[" food ","서울"],"places":[{"name":" 카페 ","locality":null,"countryCode":"kr","confidence":0.9},{"name":5,"locality":null,"countryCode":"KR","confidence":1},{"name":"카 페","locality":null,"countryCode":"KR","confidence":0.95},{"name":"low","locality":null,"countryCode":null,"confidence":0.3}],"source":null}`
	var a analysis
	if err := json.Unmarshal([]byte(valid), &a); err != nil {
		t.Fatal(err)
	}
	if err := validateAnalysis(&a); err != nil {
		t.Fatal(err)
	}
	if a.Title != strings.Repeat("👨‍👩‍👧‍👦", 40) {
		t.Errorf("title did not preserve graphemes: %q", a.Title)
	}
	if len(a.Places) != 3 || a.Places[0].CountryCode == nil || *a.Places[0].CountryCode != "KR" {
		t.Fatalf("invalid candidate handling: %#v", a.Places)
	}
	places := selectPlaces(a.Places)
	if len(places) != 1 || places[0].Name != "카페" {
		t.Fatalf("confidence or duplicate filtering failed: %#v", places)
	}
	tags := filterTags([]string{"카 페", "맛집"}, places)
	if len(tags) != 1 || tags[0] != "맛집" {
		t.Fatalf("place tag not removed: %#v", tags)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*analysis)
	}{
		{"empty title", func(v *analysis) { v.Title = "  " }},
		{"duplicate tags", func(v *analysis) { v.Tags = []string{"same", "same"} }},
		{"one tag", func(v *analysis) { v.Tags = []string{"one"} }},
		{"unknown category", func(v *analysis) { v.Category.Type = "invalid" }},
		{"missing category id", func(v *analysis) { v.Category.Type = "existing"; v.Category.CategoryID = nil }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := a
			tc.mutate(&copy)
			if validateAnalysis(&copy) == nil {
				t.Fatal("accepted malformed response")
			}
		})
	}
}

func TestMetadataRejectsPrivateTargets(t *testing.T) {
	for _, tc := range []struct {
		ip   string
		safe bool
	}{{"127.0.0.1", false}, {"10.2.3.4", false}, {"169.254.169.254", false}, {"172.31.0.1", false}, {"192.168.0.1", false}, {"::1", false}, {"fc00::1", false}, {"fe80::1", false}, {"::ffff:127.0.0.1", false}, {"8.8.8.8", true}, {"2606:4700:4700::1111", true}} {
		t.Run(tc.ip, func(t *testing.T) {
			if got := safeIP(net.ParseIP(tc.ip)); got != tc.safe {
				t.Fatalf("safeIP(%s) = %v", tc.ip, got)
			}
		})
	}
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fmt.Fprint(w, `<title>internal secret</title>`)
	}))
	defer srv.Close()
	result := metadataFetch(context.Background(), srv.URL+"/private")
	if requests.Load() != 0 {
		t.Fatal("metadata fetch contacted a loopback server")
	}
	if result.Title == nil || *result.Title != "127.0.0.1" {
		t.Fatalf("expected hostname fallback, got %#v", result.Title)
	}
}

func TestAIRoutesStatusValidationAndUsageShape(t *testing.T) {
	t.Setenv("OPEN_ROUTER_API_KEY", "")
	t.Setenv("OPEN_ROUTER_MANAGEMENT_KEY", "")
	app := testApp(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/rest/v1/ai_usage_events" || r.URL.Query().Get("user_id") != "eq.user-1" || r.URL.Query().Get("limit") != "1000" {
			t.Errorf("unexpected usage query: %s", r.URL)
		}
		return response(200, `[{"id":"event-1","provider":"google","model":"google/model","bookmark_id":null,"status":"success","error_code":null,"duration_ms":15,"is_byok":true,"created_at":"2026-01-01T00:00:00Z"}]`), nil
	})
	mux := http.NewServeMux()
	Register(mux, app)
	request := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := core.WithUserID(httptest.NewRequest("GET", path, nil), "user-1")
		mux.ServeHTTP(w, r)
		return w
	}
	status := request("/api/ai")
	if status.Code != 200 || !strings.Contains(status.Body.String(), `"enabled":false`) || !strings.Contains(status.Body.String(), preset) {
		t.Fatalf("status: %d %s", status.Code, status.Body.String())
	}
	invalid := request("/api/ai/usage?days=91")
	if invalid.Code != 400 || !strings.Contains(invalid.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("invalid days: %d %s", invalid.Code, invalid.Body.String())
	}
	usage := request("/api/ai/usage?days=7")
	var decoded struct {
		Days  int              `json:"days"`
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(usage.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if usage.Code != 200 || decoded.Days != 7 || len(decoded.Items) != 1 || decoded.Items[0]["durationMs"] != float64(15) || decoded.Items[0]["isByok"] != true {
		t.Fatalf("wrong usage response: %d %s", usage.Code, usage.Body.String())
	}
	analytics := request("/api/ai/analytics")
	if analytics.Code != 200 || !strings.Contains(analytics.Body.String(), `"configured":false`) || !strings.Contains(analytics.Body.String(), `"rows":[]`) {
		t.Fatalf("analytics: %d %s", analytics.Code, analytics.Body.String())
	}
	account := request("/api/ai/account")
	if account.Code != 400 || !strings.Contains(account.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("account: %d %s", account.Code, account.Body.String())
	}
}

func TestApplyPersistsPlacesOnlyAfterPendingTransition(t *testing.T) {
	t.Setenv("NAVER_SEARCH_CLIENT_ID", "")
	t.Setenv("NAVER_SEARCH_CLIENT_SECRET", "")
	var operations []string
	app := testApp(t, func(r *http.Request) (*http.Response, error) {
		operations = append(operations, r.Method+" "+r.URL.Path)
		switch {
		case r.Method == "PATCH" && r.URL.Path == "/rest/v1/bookmarks":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["category_id"] != "category-1" || body["ai_status"] != "done" || body["ai_model"] != "google/model" || body["places_analyzed_at"] == nil {
				t.Errorf("incorrect analysis update: %#v", body)
			}
			tags, ok := body["tags"].([]any)
			if !ok || len(tags) != 1 || tags[0] != "맛집" {
				t.Errorf("place tags not removed: %#v", body["tags"])
			}
			return response(200, `[{"id":"bookmark-1"}]`), nil
		case r.Method == "DELETE" && r.URL.Path == "/rest/v1/bookmark_places":
			if r.URL.Query().Get("user_id") != "eq.user-1" || r.URL.Query().Get("bookmark_id") != "eq.bookmark-1" {
				t.Errorf("unscoped delete: %s", r.URL.RawQuery)
			}
			return response(204, ""), nil
		case r.Method == "POST" && r.URL.Path == "/rest/v1/bookmark_places":
			var rows []map[string]any
			if err := json.NewDecoder(r.Body).Decode(&rows); err != nil {
				t.Fatal(err)
			}
			if len(rows) != 2 || rows[0]["geocode_status"] != "pending" || rows[1]["geocode_status"] != "skipped" || rows[0]["position"] != float64(0) || rows[1]["position"] != float64(1) {
				t.Errorf("wrong places: %#v", rows)
			}
			return response(201, ""), nil
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			return response(500, ""), nil
		}
	})
	domestic, foreign := "KR", "JP"
	var result analysis
	id := "category-1"
	result.Category.Type = "existing"
	result.Category.CategoryID = &id
	result.Title = "제목"
	result.Tags = []string{"카페", "맛집"}
	result.Places = []place{{Name: "카페", CountryCode: &domestic, Confidence: 0.95}, {Name: "도쿄", CountryCode: &foreign, Confidence: 0.9}}
	if err := apply(context.Background(), app, "user-1", "bookmark-1", bookmark{}, []category{{ID: id, Name: "음식"}}, result, "google/model"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(operations, ",") != "PATCH /rest/v1/bookmarks,DELETE /rest/v1/bookmark_places,POST /rest/v1/bookmark_places" {
		t.Fatalf("unexpected write sequence: %v", operations)
	}
}

func TestSourceMetadataRequiresTrustedHostAndConfidence(t *testing.T) {
	post := "https://evil.example/watch?v=123"
	handle := "@valid_user"
	s := &source{Platform: "instagram", PostURL: &post, Handle: &handle, Confidence: 0.9}
	key, value := sourceEntry(s)
	if key != "인스타그램" || value != "https://www.instagram.com/valid_user/" {
		t.Fatalf("untrusted URL accepted: %q %q", key, value)
	}
	trusted := "https://www.instagram.com/p/abc"
	s.PostURL = &trusted
	key, value = sourceEntry(s)
	if key != "인스타그램" || value != trusted {
		t.Fatalf("valid post rejected: %q %q", key, value)
	}
	s.Confidence = 0.84
	key, value = sourceEntry(s)
	if key != "" || value != "" {
		t.Fatal("low-confidence source accepted")
	}
}
