# OpenRouter 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 분류 백엔드를 Gemini/Anthropic/OpenAI 3-provider 직결 구조에서 **OpenRouter 단일 게이트웨이**로 전환한다. 사용자는 OpenRouter API 키 하나만 관리하고, 모델 우선순위(DND)·폴백 체인·사용량 대시보드는 그대로 동작한다.

**Architecture:** `packages/ai`는 SDK 3종을 모두 버리고 OpenRouter chat completions를 **fetch + zod**로 직접 호출하는 단일 provider가 된다(구조화 출력은 `response_format: json_schema, strict: true` + `provider: { require_parameters: true }` — OpenAI SDK 타입에 없는 OpenRouter 확장 파라미터라 SDK 대신 fetch를 쓴다). 모델 폴백은 **기존 자체 체인 루프를 유지**한다(시도별 usage 이벤트 기록이 대시보드의 데이터 원천이므로 OpenRouter의 `models` 배열 폴백은 쓰지 않는다). `ai_settings`는 provider별 키 3개 → `openrouter_api_key_encrypted` 하나로, 모델 카탈로그는 OpenRouter 모델 id로 바뀐다.

**Tech Stack:** 기존 스택. `packages/ai`에서 `@google/genai`, `@anthropic-ai/sdk`, `openai` 의존성 제거(순수 fetch).

**선행 상태:** 플랜 #2 Task 5까지 완료(`c07c4cf`). 미커밋 없음. 마이그레이션 0005·0006·0007은 파일만 존재하고 **원격 push 전** — 이 플랜의 0008과 함께 사용자가 일괄 push한다.

---

## 확인된 OpenRouter API 사실 (2026-07-12, 공식 docs)

- Base URL `https://openrouter.ai/api/v1`, 인증 `Authorization: Bearer <key>`, 엔드포인트 `POST /chat/completions` (OpenAI Chat API 호환 응답 스키마).
- 구조화 출력: `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. provider 라우팅 옵션 `provider: { require_parameters: true }`로 구조화 출력을 지원하는 업스트림으로만 라우팅.
- 권장 식별 헤더: `HTTP-Referer`(앱 URL), `X-Title`(앱 이름).
- `GET /api/v1/models`: 공개 모델 목록(인증 불요). `GET /api/v1/key`: 현재 키 메타데이터(키 유효성 확인 용도 — 구현 시 실제 응답 형태 확인).
- 응답의 `model` 필드가 실제 사용된 모델을 나타낸다. provider-layer failover(같은 모델의 다른 공급자로 자동 재시도)는 기본 활성 — 우리 체인 폴백과 별개로 공짜 신뢰성 향상.

## 결정 사항 (구현 중 재논의 금지 — PROGRESS 결정 로그에 기록할 것)

| 결정 | 이유 |
|---|---|
| 3-provider 전면 교체 (병행 없음). 기존 provider별 암호화 키는 마이그레이션에서 폐기 | 사용자가 "전환"을 명시. 키는 사용자가 OpenRouter 키로 재등록 |
| 폴백은 자체 체인 루프 유지, OpenRouter `models` 배열 미사용 | 시도별 성공/실패 usage 이벤트가 대시보드의 원천 데이터. OpenRouter 측 폴백은 어떤 모델이 왜 실패했는지 기록을 남기지 못함 |
| `packages/ai`는 SDK 없이 fetch 직접 호출 | `provider.require_parameters` 등 OpenRouter 확장 파라미터가 OpenAI SDK 타입에 없다. `any`/단언 없이 쓰려면 fetch + zod 경계 검증이 정석이고, 의존성 3개가 사라진다 |
| 모델 카탈로그는 고정 6개 유지, id만 OpenRouter 형식(`vendor/model`)으로. **구현 시 `GET /api/v1/models` 실측으로 id 확정** | 기존 "고정 카탈로그" 결정 유지. OpenRouter id는 문서가 아니라 실측이 정답 |
| `ai_settings.provider` 컬럼과 `aiProviderNameSchema` 제거. 카탈로그의 vendor는 표시용 라벨로만 | provider 개념이 사라짐. 모델 id에 vendor가 포함됨 |
| `ai_usage_events.provider`는 모델 id의 vendor prefix(`google` 등)를 저장, check 제약 제거. 과거 행은 그대로 | 히스토리 보존. 대시보드는 model 기준 표시라 영향 없음 |
| `bookmarks.ai_model`의 과거 값(구 모델 id)은 그대로 둔다 | free text로 설계한 이유. `modelLabel()`이 카탈로그 밖 id를 raw로 표시 |
| 상태 응답은 `{ model, modelOrder, enabled, keyConfigured }`로 단순화 (providers 맵 제거) | 키가 하나뿐 |
| 키/테스트 API는 `PUT/DELETE /api/ai/key`, `POST /api/ai/test`로 단순화 | `:provider` 파라미터 무의미 |
| 토큰/비용 기록은 이번 범위 밖 | 사용자 요구는 호출 횟수 기준으로 충족. OpenRouter `usage.include` 확장은 추후 |
| 마이그레이션 0008은 파일 생성만, push는 사용자가 0005~0008 일괄 실행 | 원격 DB 변경은 사용자 검토 사항 |

## File Structure

| 파일 | 변경 |
|---|---|
| `supabase/migrations/0008_openrouter.sql` | **생성** — ai_settings 개편, usage provider 제약 제거 |
| `packages/ai/src/types.ts` | AiProviderConfig `{ apiKey, model }`, AiProviderName 제거 |
| `packages/ai/src/providers.ts` | 3클래스 삭제 → fetch 기반 `OpenRouterProvider` |
| `packages/ai/src/schema.ts` | openrouter 응답(zod) 스키마 추가, jsonSchema/프롬프트 유지 |
| `packages/ai/package.json` | SDK 3종 의존성 제거 |
| `packages/shared/src/index.ts` | 카탈로그·aiModelIdSchema OpenRouter id, status/키 요청 스키마 개편, aiProviderNameSchema 제거 |
| `apps/api/src/services/ai-provider.ts` | 단일 키 구조, 체인·reorder 유지 |
| `apps/api/src/services/categorize.ts` | AiProviderCandidate.provider → vendor 문자열 |
| `apps/api/src/routes/ai.ts` | `/ai/key`, `/ai/test`로 개편 |
| `apps/web/src/lib/api-client.ts` | saveAiKey/deleteAiKey/testAiConnection |
| `apps/web/src/routes/_authed/settings.tsx` | provider 카드 3개 → OpenRouter 키 카드 1개 |
| `apps/web/src/routes/_authed/ai-usage.tsx` | modelLabel은 자동 대응(카탈로그 갱신) — 변경 최소 |
| 테스트 | packages/ai 전면 재작성, ai-provider/ai-routes/categorize/-settings 대폭 수정 |

검증: 각 Task 마지막에 `bun run typecheck && bun run lint && bun run test`, 최종 Task에서 build 포함.

---

### Task 1: packages/ai를 OpenRouter 단일 provider로 교체

이 Task는 `packages/ai` 내부와 api의 `providerFactory` 호출 시그니처만 바꾼다. shared 카탈로그(구 모델 id)는 Task 2에서 바꾼다 — **이 Task 완료 시점에 자동 검증은 green이지만, 실 AI 호출은 구 id가 OpenRouter로 전달되므로 동작하지 않는 과도기 상태**임을 인지할 것(커밋 메시지에 명시).

**Files:**
- Modify: `packages/ai/src/types.ts`, `packages/ai/src/providers.ts`, `packages/ai/src/schema.ts`, `packages/ai/src/index.ts`, `packages/ai/package.json`
- Modify: `apps/api/src/services/ai-provider.ts` (providerFactory 호출 2곳)
- Test: `packages/ai/src/__tests__/provider.test.ts` 전면 재작성, `packages/ai/src/__tests__/openai-schema.test.ts` 삭제

- [ ] **Step 1: 실패하는 테스트 작성 — OpenRouter provider 계약**

`packages/ai/src/__tests__/provider.test.ts`를 아래로 교체 (fetch를 mock — SDK mock 전부 삭제):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiProvider } from "../index";

const expected = {
  category: {
    type: "existing" as const,
    categoryId: "cat-dev",
    confidence: 0.91,
  },
  summaryTitle: "React 19 핵심 변경 사항",
  summary:
    "React 19에서 달라진 핵심 API를 정리한다. Actions와 use 훅 중심으로 마이그레이션 포인트를 짚는다.",
  tags: ["React", "프론트엔드", "자바스크립트"],
};

function completionResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter provider", () => {
  it("calls chat completions with strict json_schema and returns the parsed analysis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(expected));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAiProvider({
      apiKey: "or-key",
      model: "google/gemini-2.5-flash-lite",
    });

    await expect(
      provider.categorize({
        url: "https://example.com",
        title: "React 19",
        existingCategories: [{ id: "cat-dev", name: "💻 개발" }],
      }),
    ).resolves.toEqual(expected);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer or-key");
    expect(headers.get("X-Title")).toBe("my-bookmark");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemini-2.5-flash-lite");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws with the HTTP status attached when OpenRouter responds non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        }),
      ),
    );
    const provider = createAiProvider({
      apiKey: "or-key",
      model: "google/gemini-2.5-flash-lite",
    });

    await expect(
      provider.categorize({ url: "https://example.com", existingCategories: [] }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("throws when the completion content is not a valid analysis", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(completionResponse("not json")),
    );
    const provider = createAiProvider({
      apiKey: "or-key",
      model: "google/gemini-2.5-flash-lite",
    });

    await expect(
      provider.categorize({ url: "https://example.com", existingCategories: [] }),
    ).rejects.toThrow("AI analysis response is malformed");
    warn.mockRestore();
  });

  it("validates the key against GET /key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAiProvider({
      apiKey: "or-key",
      model: "google/gemini-2.5-flash-lite",
    });

    await expect(provider.validateConnection()).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/key",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(provider.validateConnection()).rejects.toMatchObject({
      status: 401,
    });
  });
});
```

`parseAnalyzeResponse`/`analyzeResponseSchema`의 기존 파싱 테스트(이모지 이름, 301자 summary 거부 등)는 **유지**한다 — SDK mock에 얽힌 부분만 걷어낸다. `openai-schema.test.ts`는 삭제(zodTextFormat 소멸).

Run: `bun run test` → RED 확인.

- [ ] **Step 2: 타입·provider 구현 교체**

`packages/ai/src/types.ts`:

```ts
export interface AiProviderConfig {
  apiKey: string;
  model: string;
}
```

(`AiProviderName` 타입 제거. `AiProvider` 인터페이스는 `name`/`model`/`categorize`/`validateConnection` 유지 — `name`은 항상 `"openrouter"`.)

`packages/ai/src/schema.ts`에 응답 경계 스키마 추가:

```ts
export const openRouterCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
});
```

`packages/ai/src/providers.ts` 전체 교체:

```ts
import {
  jsonSchema,
  openRouterCompletionSchema,
  parseAnalyzeResponse,
  systemPrompt,
  userPrompt,
  withTimeout,
} from "./schema";
import type {
  AiProvider,
  AiProviderConfig,
  AnalyzeResult,
  CategorizeInput,
} from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const APP_TITLE = "my-bookmark";

export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

export function createAiProvider(config: AiProviderConfig): AiProvider {
  return new OpenRouterProvider(config.apiKey, config.model);
}

class OpenRouterHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterHttpError";
  }
}

class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": APP_TITLE,
    };
  }

  async validateConnection(): Promise<void> {
    await withTimeout(async (signal) => {
      const response = await fetch(`${OPENROUTER_BASE_URL}/key`, {
        headers: this.headers(),
        signal,
      });
      if (!response.ok) {
        throw new OpenRouterHttpError(
          `OpenRouter key check failed (${response.status})`,
          response.status,
        );
      }
    }, 10_000);
  }

  async categorize(input: CategorizeInput): Promise<AnalyzeResult> {
    return withTimeout(async (signal) => {
      const response = await fetch(
        `${OPENROUTER_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: systemPrompt() },
              { role: "user", content: userPrompt(input) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "bookmark_analysis",
                strict: true,
                schema: jsonSchema,
              },
            },
            provider: { require_parameters: true },
          }),
          signal,
        },
      );
      if (!response.ok) {
        throw new OpenRouterHttpError(
          `OpenRouter completion failed (${response.status})`,
          response.status,
        );
      }
      const parsed = openRouterCompletionSchema.safeParse(
        await response.json(),
      );
      const content = parsed.success
        ? (parsed.data.choices[0]?.message.content ?? "")
        : "";
      return parseJsonText(content);
    });
  }
}

function parseJsonText(text: string): AnalyzeResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    console.warn("AI JSON parse failed", error);
    throw new Error("AI analysis response is malformed", { cause: error });
  }
  const result = parseAnalyzeResponse(value);
  if (!result) {
    throw new Error("AI analysis response is malformed");
  }
  return result;
}
```

주의: `jsonSchema`는 strict 모드 요구사항(모든 property가 required, `additionalProperties: false`)을 이미 충족한다. strict에서 optional 표현이 필요한 `summary`는 required로 두고(생성 강제), zod 파싱(`nullish`) 완화는 그대로 유지.

`packages/ai/src/index.ts`: `DEFAULT_MODELS` export를 `DEFAULT_MODEL`로 교체, `AiProviderName` re-export 제거.

`packages/ai/package.json`: `@google/genai`, `@anthropic-ai/sdk`, `openai` 의존성 제거 후 저장소 루트에서 `bun install`.

- [ ] **Step 3: api의 providerFactory 호출부 시그니처 맞춤**

`apps/api/src/services/ai-provider.ts`에서 `providerFactory({ provider: ..., model, apiKey })` 호출 2곳(getProviderChain, testConnection)을 `providerFactory({ model, apiKey })`로 수정. 이 Task에서는 그 외 로직(키 컬럼 3개, effectiveModelOrder 등)을 바꾸지 않는다 — `keyColumns[item.provider]` 접근은 카탈로그의 provider 필드가 아직 남아 있으므로 컴파일된다. `ai-provider.test.ts`의 providerFactory mock이 config.provider를 단언하고 있으면 model 기준 단언으로 조정한다.

- [ ] **Step 4: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: AI provider를 OpenRouter 단일 게이트웨이로 교체 (카탈로그 전환 전 과도기)"
```

---

### Task 2: 카탈로그·설정·API·UI를 OpenRouter 체계로 전환 (원자적)

shared 스키마 변경이 api·web 전역에 파급되므로 이 Task는 한 커밋으로 처리한다.

**Files:**
- Create: `supabase/migrations/0008_openrouter.sql`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/services/ai-provider.ts`, `apps/api/src/services/categorize.ts`, `apps/api/src/services/ai-usage.ts`, `apps/api/src/routes/ai.ts`
- Modify: `apps/web/src/lib/api-client.ts`, `apps/web/src/routes/_authed/settings.tsx`
- Test: `ai-provider.test.ts`, `ai-routes.test.ts`, `categorize.test.ts`, `ai-usage.test.ts`, `-settings.test.tsx`, shared `ai-settings.test.ts` 등 typecheck가 가리키는 전부

- [ ] **Step 1: 실제 모델 id 확정 (네트워크 필요)**

Run: `curl -s https://openrouter.ai/api/v1/models | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data']]" | grep -E "google/gemini|anthropic/claude|openai/gpt" | sort`

아래 후보와 대조해 **실존하는 id로 카탈로그를 확정**하고, 최종 선택을 PROGRESS 결정 로그에 기록한다. 후보(실측과 다르면 실측 우선, 저비용/균형 2개씩 유지):

| 슬롯 | 후보 id | 라벨 | tier |
|---|---|---|---|
| Google 저비용 | `google/gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite | 저비용 |
| Google 균형 | `google/gemini-2.5-flash` | Gemini 2.5 Flash | 균형 |
| Anthropic 저비용 | `anthropic/claude-haiku-4.5` | Claude Haiku 4.5 | 저비용 |
| Anthropic 균형 | `anthropic/claude-sonnet-4.6` (없으면 4.5) | Claude Sonnet | 균형 |
| OpenAI 저비용 | `openai/gpt-4o-mini` | GPT-4o mini | 저비용 |
| OpenAI 균형 | `openai/gpt-5.4-mini` (없으면 `openai/gpt-5-mini`) | GPT-5 mini 계열 | 균형 |

- [ ] **Step 2: shared 스키마 개편**

`packages/shared/src/index.ts`:
- `aiModelIdSchema`를 Step 1에서 확정한 6개 id의 `z.enum`으로 교체.
- `AI_MODEL_CATALOG`: `provider` 필드를 표시용 `vendor` 라벨로 교체:

```ts
export const AI_MODEL_CATALOG = [
  { model: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", vendor: "Google", tier: "저비용" },
  // ...확정된 6개
] as const;
```

- `aiProviderNameSchema`·`AiProviderName` 삭제.
- 상태/키 스키마 교체:

```ts
export const aiStatusResponseSchema = z.object({
  model: aiModelIdSchema,
  modelOrder: z.array(aiModelIdSchema),
  enabled: z.boolean(),
  keyConfigured: z.boolean(),
});
export const saveAiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(512),
});
```

(`saveAiProviderKeyRequestSchema`는 `saveAiKeyRequestSchema`로 개명, `aiConnectionTestResponseSchema`는 `z.object({ ok: z.boolean() })`로 축소.)
- `aiUsageEventSchema.provider`: `aiProviderNameSchema` → `z.string()`.
- `reorderAiModelsRequestSchema`는 그대로(참조하는 enum만 새 id).

- [ ] **Step 3: 마이그레이션 생성 (push 금지)**

Create `supabase/migrations/0008_openrouter.sql` — 기본 모델 id는 Step 1 확정값으로 치환:

```sql
alter table public.ai_settings
  drop constraint if exists ai_settings_provider_model_check;

alter table public.ai_settings
  drop column provider,
  drop column gemini_api_key_encrypted,
  drop column anthropic_api_key_encrypted,
  drop column openai_api_key_encrypted,
  add column openrouter_api_key_encrypted text;

alter table public.ai_settings
  alter column model set default 'google/gemini-2.5-flash-lite';

update public.ai_settings
set model = 'google/gemini-2.5-flash-lite',
    model_order = '{}';

-- 0007의 inline check 제약 이름을 확인 후 제거 (postgres 자동 명명: <table>_<column>_check)
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_provider_check;
```

- [ ] **Step 4: api 서비스·라우트 개편**

`apps/api/src/services/ai-provider.ts`:
- row 스키마: `{ user_id, model: aiModelIdSchema, model_order, openrouter_api_key_encrypted: z.string().nullable() }`. `keyColumns`/`defaultModels` 삭제, `emptyValues`는 `{ model: DEFAULT카탈로그첫모델, model_order: [], openrouter_api_key_encrypted: null }`.
- `effectiveModelOrder`: 키가 있으면 카탈로그 전체가 usable, 없으면 `[]`.
- 인터페이스: `saveKey(userId, apiKey)`, `deleteKey(userId)`, `testConnection(userId)` (provider 파라미터 제거), `reorderModels`/`getProviderChain`/`getStatus`/`invalidate` 유지.
- `toStatus`: `{ model, modelOrder: effectiveModelOrder(values), enabled: order.length > 0, keyConfigured: key !== null }`.
- `getProviderChain`: 후보의 `provider` 필드는 모델 id의 vendor prefix(`model.split("/")[0] ?? "openrouter"`).
- `testConnection`: 단일 키 복호화 → `providerFactory({ model: values.model, apiKey }).validateConnection()`.

`apps/api/src/services/categorize.ts`: `AiProviderCandidate.provider`를 `"gemini" | "anthropic" | "openai"` 유니온에서 `string`으로 완화. `AiUsageEventInput.provider`도 동일.

`apps/api/src/routes/ai.ts`:

```ts
router.put("/ai/key", ...)      // saveAiKeyRequestSchema, service.saveKey(userId, body.apiKey)
router.delete("/ai/key", ...)   // service.deleteKey(userId)
router.post("/ai/test", ...)    // { ok } 반환
```

(`/ai/keys/:provider`, `/ai/test/:provider` 삭제. `GET /ai`, `PUT /ai/model-order`, `GET /ai/usage` 유지.)

테스트: `ai-provider.test.ts`(repository mock 행을 새 컬럼으로, 키 저장/삭제/체인/reorder), `ai-routes.test.ts`(새 경로), `ai-usage.test.ts`(provider 문자열), `categorize.test.ts`(candidate helper의 provider 인자), shared `ai-settings.test.ts` — typecheck·테스트 실패가 가리키는 전부를 새 체계로 갱신. 신규 모델 id 문자열은 반드시 Step 1 확정값 사용.

- [ ] **Step 5: web 개편**

`apps/web/src/lib/api-client.ts`:

```ts
export async function saveAiKey(body: SaveAiKeyRequest): Promise<AiStatusResponse> { /* PUT /api/ai/key */ }
export async function deleteAiKey(): Promise<AiStatusResponse> { /* DELETE /api/ai/key */ }
export async function testAiConnection(): Promise<{ ok: boolean }> { /* POST /api/ai/test */ }
```

(`saveAiProviderKey`/`deleteAiProviderKey`/`testAiProviderConnection` 삭제.)

`apps/web/src/routes/_authed/settings.tsx` `AiSection`:
- `aiProviderLabels`/`aiProviderNames`/`emptyAiKeys` 삭제. 키 상태는 단일 `useState("")`.
- provider 카드 3개 grid → **OpenRouter API 키 카드 1개**: 상태 배지(`keyConfigured ? "설정됨" : "API 키 필요"`), password input(placeholder "sk-or-..."), 키 저장/교체·연결 테스트·키 삭제 버튼, "키는 openrouter.ai/keys에서 발급" 안내 문구.
- 모델 우선순위 DND 리스트는 유지 — 항목 부제를 `{item.vendor} · {item.tier}`로.
- 대시보드 링크 유지.
- `-settings.test.tsx`: mock factory·fixture(`aiStatus`)·단언을 새 shape로. DND 리스트 테스트의 모델 id/라벨을 새 카탈로그 값으로.

- [ ] **Step 6: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과. 잔여 참조 확인:

Run: `grep -rn "gemini_api_key\|anthropic_api_key\|openai_api_key\|aiProviderName\|AiProviderName\|keys/:provider\|test/:provider" packages apps --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v migrations`
Expected: 매치 없음.

```bash
git add -A
git commit -m "feat: AI 설정을 OpenRouter 단일 키와 새 모델 카탈로그로 전환"
```

---

### Task 3: 문서 동기화 + 전체 검증 + PROGRESS 갱신 (플랜 #2 Task 6 잔여분 통합)

**Files:**
- Modify: `docs/02-database.md`, `docs/03-api.md`, `docs/05-ai.md`, `PROGRESS.md`

- [ ] **Step 1: docs 갱신 — 플랜 #1·#2·#3 변경 전부 반영**

- `docs/02-database.md`: categories color 제거, bookmarks.ai_model, ai_settings 최종 형태(openrouter 키·model·model_order), ai_usage_events.
- `docs/03-api.md`: 카테고리(color 제거, PUT /order), AI(`GET /ai` 새 shape, `PUT /ai/key`, `DELETE /ai/key`, `POST /ai/test`, `PUT /ai/model-order`, `GET /ai/usage`), bookmark 응답 aiModel.
- `docs/05-ai.md`: OpenRouter 아키텍처(fetch + json_schema strict + require_parameters, 체인 폴백은 자체 구현, 시도별 usage 기록), 새 모델 카탈로그 표, summary/이모지 카테고리 규칙, "모델 id는 실측으로 확정" 원칙.
- `.env.example`·`docs/01-architecture.md`에 남은 provider별 AI 키 언급이 있으면 정리(키는 DB 저장이므로 env 항목 없음이 정상).

- [ ] **Step 2: 전체 검증 루프**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: 전부 통과.

- [ ] **Step 3: PROGRESS.md 갱신 + Commit**

결정 로그에 이 플랜의 결정 사항 표 + 플랜 #1·#2에서 아직 기록 안 된 항목 추가. "사용자 확인 필요"에 기록: (1) `bun x supabase db push`로 0005~0008 일괄 적용(dry-run 선행), (2) push 후 OpenRouter 키 등록 → mode=ai 등록 → 분류·폴백(우선순위 1번을 존재하지 않는 키로 실패 유도 불가하므로 429 시나리오는 자연 관찰)·편집 모달 모델 표시·대시보드 데이터 확인, (3) 카테고리/모델 DND 터치 드래그(iOS).

```bash
git add -A
git commit -m "docs: OpenRouter 전환과 AI 기능 확장 반영"
```

---

## 주의사항 (구현 세션 필독)

- **모델 id를 추측으로 쓰지 말 것.** Task 2 Step 1의 실측 결과만 사용하고 PROGRESS에 기록한다.
- **OpenRouter API 형태가 계획서와 다르면** (예: `/key` 응답, `require_parameters` 위치) 공식 docs(openrouter.ai/docs)를 확인해 실제에 맞추고 이탈로 보고한다.
- **마이그레이션 push 금지.** 0008은 파일 생성까지만.
- `any`/`@ts-ignore` 금지, 테스트 skip 금지, 검증 실패 상태로 커밋 금지.
- Task 1 커밋은 "실 호출 과도기" 상태임을 커밋 메시지에 남기고, Task 2를 같은 세션 흐름에서 바로 잇는다.
