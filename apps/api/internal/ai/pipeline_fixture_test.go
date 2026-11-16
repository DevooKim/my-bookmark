package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

const fixtureAnalysis = `{"category":{"type":"existing","categoryId":"cat-1","name":null,"confidence":0.95},"summaryTitle":"서울 카페","summary":"좋은 공간","tags":["카페","여행"],"places":[{"name":"카페","locality":"서울","countryCode":"KR","confidence":0.95}],"source":null}`

func fixtureChatResponse() string {
	b, _ := json.Marshal(map[string]any{"model": "google/fixture", "choices": []any{map[string]any{"message": map[string]any{"content": fixtureAnalysis}}}, "usage": map[string]any{"is_byok": true}})
	return string(b)
}

func fixtureVector() string {
	return `{"data":[{"index":0,"embedding":[` + strings.TrimSuffix(strings.Repeat("0.25,", 1536), ",") + `]}]}`
}

func TestProviderAnalysisRequestFixtures(t *testing.T) {
	t.Setenv("OPEN_ROUTER_API_KEY", "fixture-key")
	t.Setenv("OPEN_ROUTER_MODELS", "first/model, second/model")
	for _, image := range []string{"", "data:image/jpeg;base64,YWJj"} {
		t.Run(fmt.Sprintf("image=%t", image != ""), func(t *testing.T) {
			app := testApp(t, func(r *http.Request) (*http.Response, error) {
				if r.Method != "POST" || r.URL.String() != baseURL+"/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("unexpected provider request: %s %s %#v", r.Method, r.URL, r.Header)
				}
				var body struct {
					Models   []string `json:"models"`
					Messages []struct {
						Role    string          `json:"role"`
						Content json.RawMessage `json:"content"`
					} `json:"messages"`
					ResponseFormat struct {
						Type string `json:"type"`
					} `json:"response_format"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if strings.Join(body.Models, ",") != "first/model,second/model" || len(body.Messages) != 2 || body.ResponseFormat.Type != "json_schema" {
					t.Fatalf("unexpected body: %#v", body)
				}
				if image == "" {
					var content string
					if err := json.Unmarshal(body.Messages[1].Content, &content); err != nil || !strings.Contains(content, `"url": "https://example.test"`) {
						t.Errorf("link content: %s (%v)", body.Messages[1].Content, err)
					}
				} else if !strings.Contains(string(body.Messages[1].Content), image) {
					t.Errorf("image content: %s", body.Messages[1].Content)
				}
				return response(200, fixtureChatResponse()), nil
			})
			result, model, byok, err := analyze(context.Background(), app, map[string]any{"url": "https://example.test", "title": "Title", "instruction": "Analyze", "existingCategories": []category{{ID: "cat-1", Name: "여행"}}}, image)
			if err != nil || model != "google/fixture" || byok == nil || !*byok || result.Title != "서울 카페" || len(result.Places) != 1 {
				t.Fatalf("analysis=%#v model=%q byok=%v err=%v", result, model, byok, err)
			}
		})
	}
}

func TestEmbeddingRequestResponseFixtures(t *testing.T) {
	t.Setenv("OPEN_ROUTER_API_KEY", "fixture-key")
	for _, tc := range []struct {
		name, body string
		status     int
		ok         bool
	}{
		{"success", fixtureVector(), 200, true},
		{"upstream failure", `{}`, 503, false},
		{"wrong dimensions", `{"data":[{"index":0,"embedding":[1]}]}`, 200, false},
		{"wrong index", `{"data":[{"index":1,"embedding":[1]}]}`, 200, false},
		{"invalid JSON", `{`, 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := testApp(t, func(r *http.Request) (*http.Response, error) {
				if r.Method != "POST" || r.URL.String() != baseURL+"/embeddings" || r.Header.Get("Authorization") != "Bearer fixture-key" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body["model"] != "openai/text-embedding-3-small" || body["input"] != "제목\n요약\n태그" || body["encoding_format"] != "float" {
					t.Errorf("unexpected body: %#v", body)
				}
				return response(tc.status, tc.body), nil
			})
			v, err := Embed(context.Background(), app, "제목\n요약\n태그")
			if (err == nil) != tc.ok || (tc.ok && (len(v) != 1536 || v[0] != 0.25)) {
				t.Fatalf("vector length=%d error=%v", len(v), err)
			}
		})
	}
}

func TestCategorizeSuccessPipelineAndEmbeddingWrite(t *testing.T) {
	t.Setenv("OPEN_ROUTER_API_KEY", "fixture-key")
	t.Setenv("NAVER_SEARCH_CLIENT_ID", "")
	finished := make(chan struct{}, 1)
	var usage, analysisWrite, placesWrite bool
	app := testApp(t, func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "openrouter.ai" && r.URL.Path == "/api/v1/chat/completions":
			return response(200, fixtureChatResponse()), nil
		case r.URL.Host == "openrouter.ai" && r.URL.Path == "/api/v1/embeddings":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["input"] != "서울 카페\n좋은 공간\n여행" {
				t.Errorf("embedding input: %#v", body)
			}
			return response(200, fixtureVector()), nil
		case r.Method == "GET" && r.URL.Path == "/rest/v1/bookmarks":
			return response(200, `[{"kind":"link","url":"http://127.0.0.1/private","title":"Saved","description":null,"site_name":null,"metadata":{}}]`), nil
		case r.Method == "GET" && r.URL.Path == "/rest/v1/categories":
			return response(200, `[{"id":"cat-1","name":"여행"}]`), nil
		case r.Method == "POST" && r.URL.Path == "/rest/v1/ai_usage_events":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["status"] != "success" || body["provider"] != "google" || body["model"] != "google/fixture" || body["is_byok"] != true || body["user_id"] != "user-1" || body["bookmark_id"] != "bookmark-1" || body["error_code"] != nil {
				t.Errorf("usage: %#v", body)
			}
			usage = true
			return response(201, ""), nil
		case r.Method == "PATCH" && r.URL.Path == "/rest/v1/bookmarks":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			q := r.URL.Query()
			if q.Get("user_id") != "eq.user-1" || q.Get("id") != "eq.bookmark-1" {
				t.Errorf("unscoped update: %s", r.URL.RawQuery)
			}
			if body["embedding"] != nil {
				if len(body["embedding"].([]any)) != 1536 || q.Get("ai_status") != "" {
					t.Errorf("embedding update: %#v", body)
				}
				finished <- struct{}{}
				return response(204, ""), nil
			}
			if q.Get("ai_status") != "eq.pending" {
				t.Errorf("unconditional analysis write: %s", r.URL.RawQuery)
			}
			if body["ai_status"] == "done" {
				if body["category_id"] != "cat-1" || body["title"] != "서울 카페" || body["description"] != "좋은 공간" {
					t.Errorf("analysis write: %#v", body)
				}
				analysisWrite = true
				return response(200, `[{"id":"bookmark-1"}]`), nil
			}
			return response(204, ""), nil
		case r.Method == "DELETE" && r.URL.Path == "/rest/v1/bookmark_places":
			return response(204, ""), nil
		case r.Method == "POST" && r.URL.Path == "/rest/v1/bookmark_places":
			var rows []map[string]any
			if err := json.NewDecoder(r.Body).Decode(&rows); err != nil {
				t.Fatal(err)
			}
			if len(rows) != 1 || rows[0]["name"] != "카페" || rows[0]["locality"] != "서울" || rows[0]["country_code"] != "KR" || rows[0]["geocode_status"] != "pending" {
				t.Errorf("place rows: %#v", rows)
			}
			placesWrite = true
			return response(201, ""), nil
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
			return response(500, ""), nil
		}
	})
	Categorize(context.Background(), app, "user-1", "bookmark-1")
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("embedding write not observed")
	}
	if !usage || !analysisWrite || !placesWrite {
		t.Fatalf("usage=%v analysis=%v places=%v", usage, analysisWrite, placesWrite)
	}
}

func TestGeocoderRequestResponseFixtures(t *testing.T) {
	t.Setenv("NAVER_SEARCH_CLIENT_ID", "fixture-id")
	t.Setenv("NAVER_SEARCH_CLIENT_SECRET", "fixture-secret")
	for _, tc := range []struct {
		name, body, status string
		httpStatus         int
		write              bool
	}{
		{"resolved", `{"items":[{"title":"<b>카페</b> 서울","address":"  지번  ","roadAddress":"  도로명  ","mapx":"1269780000","mapy":"375660000"}]}`, "resolved", 200, true},
		{"not found", `{"items":[{"title":"다른 곳","mapx":"1269780000","mapy":"375660000"}]}`, "not_found", 200, true},
		{"invalid coordinate", `{"items":[{"title":"카페","mapx":"NaN","mapy":"375660000"}]}`, "not_found", 200, true},
		{"malformed item", `{"items":[{"title":"카페","mapx":"1269780000"}]}`, "", 200, false},
		{"upstream error", `{"items":[]}`, "", 503, false},
		{"invalid JSON", `{`, "", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writes := 0
			app := testApp(t, func(r *http.Request) (*http.Response, error) {
				switch {
				case r.URL.Host == "naverapihub.apigw.ntruss.com":
					if r.Method != "GET" || r.URL.Path != "/search/v1/local" || r.URL.Query().Get("query") != "카페 서울" || r.URL.Query().Get("display") != "5" || r.Header.Get("X-NCP-APIGW-API-KEY-ID") != "fixture-id" || r.Header.Get("X-NCP-APIGW-API-KEY") != "fixture-secret" {
						t.Errorf("geocoder request: %s %#v", r.URL, r.Header)
					}
					return response(tc.httpStatus, tc.body), nil
				case r.Method == "GET" && r.URL.Path == "/rest/v1/bookmark_places":
					if r.URL.Query().Get("geocode_status") != "eq.pending" || r.URL.Query().Get("user_id") != "eq.user-1" || r.URL.Query().Get("bookmark_id") != "eq.bookmark-1" {
						t.Errorf("unscoped read: %s", r.URL.RawQuery)
					}
					return response(200, `[{"id":"place-1","name":"카페","locality":"서울","country_code":"KR"}]`), nil
				case r.Method == "PATCH" && r.URL.Path == "/rest/v1/bookmark_places":
					writes++
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					if r.URL.Query().Get("id") != "eq.place-1" || r.URL.Query().Get("user_id") != "eq.user-1" || body["geocode_status"] != tc.status {
						t.Errorf("geocode write: %s %#v", r.URL.RawQuery, body)
					}
					if tc.status == "resolved" && (body["lat"] != 37.566 || body["lng"] != 126.978 || body["address"] != "지번" || body["road_address"] != "도로명") {
						t.Errorf("navigation fields: %#v", body)
					}
					return response(204, ""), nil
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					return response(500, ""), nil
				}
			})
			geocodePlaces(context.Background(), app, "user-1", "bookmark-1")
			if (writes == 1) != tc.write {
				t.Fatalf("writes=%d", writes)
			}
		})
	}
}
