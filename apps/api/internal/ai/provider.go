package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"my-bookmark/api/internal/core"
)

const preset = "@preset/my-bookmark"
const baseURL = "https://openrouter.ai/api/v1"

type category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type place struct {
	Name        string  `json:"name"`
	Locality    *string `json:"locality"`
	CountryCode *string `json:"countryCode"`
	Confidence  float64 `json:"confidence"`
}
type source struct {
	Platform   string  `json:"platform"`
	Handle     *string `json:"handle"`
	PostURL    *string `json:"postUrl"`
	Repository *string `json:"repository"`
	Confidence float64 `json:"confidence"`
}
type analysis struct {
	Category struct {
		Type       string   `json:"type"`
		CategoryID *string  `json:"categoryId"`
		Name       *string  `json:"name"`
		Confidence *float64 `json:"confidence"`
	} `json:"category"`
	Title   string   `json:"summaryTitle"`
	Summary *string  `json:"summary"`
	Tags    []string `json:"tags"`
	Places  []place  `json:"places"`
	Source  *source  `json:"source"`
}
type httpStatusError struct{ status int }

func (e httpStatusError) Error() string { return fmt.Sprintf("upstream status %d", e.status) }
func client(a *core.App) *http.Client {
	if a.Client != nil {
		return a.Client
	}
	return http.DefaultClient
}
func request(ctx context.Context, a *core.App, method, endpoint, key string, body any, out any) error {
	var r io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		r = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, endpoint, r)
	if e != nil {
		return e
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Title", "my-bookmark")
	}
	resp, e := client(a).Do(req)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return httpStatusError{resp.StatusCode}
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
	}
	return nil
}
func Embed(ctx context.Context, a *core.App, text string) ([]float64, error) {
	key := os.Getenv("OPEN_ROUTER_API_KEY")
	if key == "" {
		return nil, errors.New("OpenRouter API key is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var res struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if e := request(ctx, a, "POST", baseURL+"/embeddings", key, map[string]any{"model": "openai/text-embedding-3-small", "input": text, "encoding_format": "float"}, &res); e != nil {
		return nil, e
	}
	if len(res.Data) != 1 || res.Data[0].Index != 0 || len(res.Data[0].Embedding) != 1536 {
		return nil, errors.New("malformed embedding response")
	}
	for _, v := range res.Data[0].Embedding {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, errors.New("malformed embedding response")
		}
	}
	return res.Data[0].Embedding, nil
}

var schema = json.RawMessage(`{"type":"object","properties":{"category":{"type":"object","properties":{"type":{"type":"string","enum":["existing","new","none"]},"categoryId":{"type":["string","null"]},"name":{"type":["string","null"]},"confidence":{"type":["number","null"]}},"required":["type","categoryId","name","confidence"],"additionalProperties":false},"summaryTitle":{"type":"string"},"summary":{"type":"string"},"tags":{"type":"array","items":{"type":"string"},"minItems":2,"maxItems":5},"places":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"locality":{"type":["string","null"]},"countryCode":{"type":["string","null"]},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["name","locality","countryCode","confidence"],"additionalProperties":false},"maxItems":15},"source":{"type":["object","null"],"properties":{"platform":{"type":"string","enum":["youtube","instagram","threads","x","tiktok","github"]},"handle":{"type":["string","null"]},"postUrl":{"type":["string","null"]},"repository":{"type":["string","null"]},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["platform","handle","postUrl","repository","confidence"],"additionalProperties":false}},"required":["category","summaryTitle","summary","tags","places","source"],"additionalProperties":false}`)

const prompt = `너는 저장 자료 분류기다. 링크 또는 이미지와 사용자의 기존 카테고리 목록을 보고 가장 적합한 카테고리를 고른다.
규칙:
1. 기존 카테고리 중 명확히 맞는 것이 있으면 반드시 그것을 선택한다 (id로).
2. 기존 카테고리로 무리 없이 분류할 수 없을 때만 새 카테고리를 제안한다.
3. 새 카테고리 이름은 '이모지 1개 + 공백 + 한국어 이름(1~10자)' 형식의 한 문자열로 만든다. 예: '💻 개발', '📰 뉴스', '🎨 디자인'. 이모지는 주제를 대표하는 것 1개만 앞에 붙이고, 이름은 일반적·재사용 가능한 수준으로 한다.
4. 정보가 부족해 판단이 어려우면 category에 none을 반환한다.
5. confidence는 0~1이다.
6. summaryTitle은 원문을 핵심만 요약한 한국어 제목 스타일로 작성하며 최대 40자다.
7. tags는 핵심 검색어만 중복 없이 2~5개로 작성하며 각 태그는 최대 20자다. 고유 기술명은 원문을 허용한다. 태그 2개로 충분하면 2개에서 멈춘다.
8. 개수를 채우려고 동의어·표기 변형·상하위 개념을 함께 만들지 않는다. 예를 들어 TrueNAS와 NAS는 더 구체적인 하나만 선택한다.
9. 돈까스, 돈카츠, 미소카츠처럼 의미가 겹치는 음식 태그를 나열하지 않는다. 돈까스맛집, 천호맛집, 강동구맛집처럼 같은 의도의 음식·지역 조합도 핵심 검색어 하나만 남긴다.
10. 식당 상호와 지점명은 tags에서 제외한다. 음식 종류·가장 유용한 지역·방문 목적처럼 다른 항목에도 재사용 가능한 검색어만 쓴다.
11. summary는 원문의 핵심을 한국어 1~3문장으로 요약한다. 불필요한 수식 없이 정보만 담고, 전체 300자 이내로 한다.
12. 해당 없는 필드(categoryId, name)는 null로 채운다.
13. 식당·카페·주점·매장·관광지·숙소·전시 공간 등 방문 가능한 장소의 고유 이름이 본문이나 이미지에 직접 확인되면 places에 모두 넣는다. 게시물이 여러 장소를 소개하면 본문 등장 순서대로 각각을 항목으로 넣고 최대 15개까지 반환한다.
14. 사진만 보고 장소 이름을 추측하지 않는다. '서촌 카페', '교토 맛집'처럼 고유 이름이 아닌 일반 표현과 도시·동네·국가 자체는 places에 넣지 않는다. 확인되는 장소가 없으면 places는 빈 배열이다.
15. 지점명은 places[].name에 포함하고 name은 원문 표기를 유지한다(해외 장소는 현지어·영문 표기 그대로). 확인 가능한 동네·도시는 places[].locality에 넣는다. places[].countryCode는 장소가 있는 국가의 ISO 3166-1 alpha-2 대문자 코드(한국 KR, 일본 JP)이며 본문 단서로 판단할 수 없으면 null이다.
16. YouTube, Instagram, Threads, X, TikTok, GitHub의 handle, 게시물 URL·ID, GitHub owner/repository가 이미지에 직접 보일 때만 source를 반환한다.
17. 표시명이나 로고만으로 계정을 추측하지 않는다. 직접 확인할 수 없으면 source는 null이다.
18. source.postUrl은 게시물 URL이나 ID가 직접 보일 때만 넣고, GitHub 저장소는 source.repository에 owner/repository로 넣는다.
19. 응답은 아래 JSON Schema를 정확히 따르는 JSON 객체 하나만 출력한다. 모든 필드를 포함하고, 코드펜스(` + "```" + `)나 설명 문장을 붙이지 않는다.`

func analyze(ctx context.Context, a *core.App, input map[string]any, image string) (analysis, string, *bool, error) {
	var result analysis
	key := os.Getenv("OPEN_ROUTER_API_KEY")
	if key == "" {
		return result, "", nil, errors.New("missing API key")
	}
	models := []string{"google/gemini-3.5-flash-lite", "openai/gpt-6-luna"}
	if v := strings.TrimSpace(os.Getenv("OPEN_ROUTER_MODELS")); v != "" {
		models = nil
		for _, m := range strings.Split(v, ",") {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, m)
			}
		}
	}
	var p []byte
	if image != "" {
		p, _ = json.MarshalIndent(struct {
			ContentType        string `json:"contentType"`
			Instruction        string `json:"instruction"`
			ExistingCategories any    `json:"existingCategories"`
		}{"image", input["instruction"].(string), input["existingCategories"]}, "", "  ")
	} else {
		p, _ = json.MarshalIndent(struct {
			ContentType        string `json:"contentType"`
			URL                any    `json:"url"`
			Title              any    `json:"title"`
			Description        any    `json:"description,omitempty"`
			SiteName           any    `json:"siteName,omitempty"`
			ExistingCategories any    `json:"existingCategories"`
		}{"link", input["url"], input["title"], input["description"], input["siteName"], input["existingCategories"]}, "", "  ")
	}
	var content any = string(p)
	if image != "" {
		content = []any{map[string]any{"type": "text", "text": string(p)}, map[string]any{"type": "image_url", "image_url": map[string]string{"url": image}}}
	}
	body := map[string]any{"models": models, "max_tokens": 2048, "provider": map[string]any{"require_parameters": true, "only": []string{"google-ai-studio", "openai"}, "data_collection": "deny"}, "messages": []any{map[string]any{"role": "system", "content": prompt + "\n" + string(schema)}, map[string]any{"role": "user", "content": content}}, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "bookmark_analysis", "strict": true, "schema": schema}}}
	var res struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content *string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			Byok *bool `json:"is_byok"`
		} `json:"usage"`
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if e := request(ctx, a, "POST", baseURL+"/chat/completions", key, body, &res); e != nil {
		return result, "", nil, e
	}
	if len(res.Choices) == 0 || res.Choices[0].Message.Content == nil {
		return result, "", nil, errors.New("malformed analysis")
	}
	s := strings.TrimSpace(*res.Choices[0].Message.Content)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = strings.TrimSpace(strings.TrimSuffix(s[i+1:], "```"))
		}
	}
	if e := json.Unmarshal([]byte(s), &result); e != nil {
		return result, "", nil, e
	}
	if e := validateAnalysis(&result); e != nil {
		return result, "", nil, e
	}
	if res.Model == "" {
		res.Model = preset
	}
	var byok *bool
	if res.Usage != nil {
		byok = res.Usage.Byok
	}
	return result, res.Model, byok, nil
}
