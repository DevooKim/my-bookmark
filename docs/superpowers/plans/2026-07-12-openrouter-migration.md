# OpenRouter preset 전환 Implementation Plan (v3 — 토큰·비용 로컬 저장 제외)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans를 사용해 Task 단위로 구현한다. 체크박스로 진행을 추적한다.

**Goal:** AI 분류를 OpenRouter **preset `@preset/my-bookmark`** 단일 호출로 전환한다. 키는 서버 env, 모델 선택·폴백·파라미터는 openrouter.ai의 preset이 담당한다. 대시보드는 로컬 호출 이벤트(모델/성공/실패) 집계 + OpenRouter `GET /key` 계정 사용액 카드 + openrouter.ai activity 바로가기로 구성한다. **토큰·비용은 로컬에 저장하지 않는다** — 공식 수치는 OpenRouter 쪽이며 상세 비용 분석은 openrouter.ai 대시보드가 담당(사용자 결정 2026-07-12).

**Architecture:** `packages/ai`는 SDK 없이 fetch로 `POST /chat/completions`를 호출한다(`model: "@preset/my-bookmark"`, strict json_schema, `max_tokens: 2048`). 앱 내 모델 카탈로그·model_order·폴백 체인·provider별 키 관리(`ai_settings` 테이블 포함)는 **전부 제거**. 분류 응답의 실사용 `model`을 `bookmarks.ai_model`과 `ai_usage_events`에 기록한다(이벤트 스키마는 현행 유지 — 컬럼 추가 없음).

**선행 상태:** `c91f3ed`까지 커밋 완료. 마이그레이션 0005~0007은 파일만 존재(원격 미적용) — 이 플랜의 0008과 함께 사용자가 일괄 push. `OPEN_ROUTER_API_KEY`는 루트 `.env`에 존재.

---

## 실측으로 확인된 사실 (2026-07-12, 실제 키로 검증 완료)

1. `@preset/my-bookmark` 호출 성공. 응답 `model` 필드에 실사용 모델(`google/gemini-3.1-flash-lite-20260507`)이 온다. 기존 카테고리 id 매칭·이모지 신규 이름·1~3문장 summary·태그가 정확한 JSON으로 반환됨을 확인.
2. **strict json_schema 주의 2가지 (400/402 재현 후 해결 확인):**
   - OpenAI 계열 업스트림은 strict 모드에서 **모든 property가 `required`에 포함**되어야 한다. 조건부 필드(categoryId/name/confidence)는 `"type": ["string", "null"]`식 nullable로 선언하고 전부 required에 넣는다.
   - `max_tokens` 미지정 시 기본값이 매우 커서(65536) 일부 업스트림에서 402가 난다. **반드시 명시**(2048).
3. `GET /api/v1/key`(inference 키 가능): `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`(USD), `limit`, `limit_remaining`, `is_free_tier` 반환 — 계정 사용액 카드의 데이터 소스.
4. `/api/v1/activity`·`/api/v1/analytics/query`는 **management key 전용(403)** — 사용하지 않는다. 모델별·일별 비용 집계는 API로 불가하므로 상세 비용 분석은 openrouter.ai activity 페이지로 안내한다.
5. `provider: { require_parameters: true }`는 구조화 출력 지원 업스트림으로만 라우팅하는 OpenRouter 확장 파라미터.

## 결정 사항 (사용자 확정 2026-07-12 — 재논의 금지, PROGRESS 결정 로그에 기록)

| 결정 | 이유 |
|---|---|
| 키는 서버 env `OPEN_ROUTER_API_KEY` (설정 화면 키 관리 UI 삭제, `ai_settings` 테이블 drop) | 사용자 선택. 1인 서비스 + preset 위임 구조에서 최단순 |
| 모델 선택·폴백·파라미터는 preset `@preset/my-bookmark`에 전부 위임. 앱 내 모델 우선순위 DND·폴백 체인·AI_MODEL_CATALOG·model_order 제거 | 사용자 선택. 모델 운영은 openrouter.ai 대시보드에서 |
| **토큰·비용은 로컬 저장하지 않음.** 이벤트는 현행 스키마(모델/상태/duration) 유지, 비용 상세는 openrouter.ai activity + `/key` 계정 카드 | 사용자 결정. 공식 수치는 OpenRouter이고(BYOK·캐시 할인으로 사본은 오차 가능), 로컬 이벤트의 고유 가치는 북마크와 연결된 호출/실패 이력 |
| `packages/ai`는 fetch + zod (SDK 3종 의존성 제거) | `provider.require_parameters` 등 확장 파라미터가 OpenAI SDK 타입에 없음. `any` 없이 정석 처리 |
| strict 스키마는 nullable-전부-required 형태, `max_tokens: 2048` 명시 | 실측 400/402의 직접 대응 |
| 실패 이벤트의 model은 `"@preset/my-bookmark"`, 성공 이벤트는 응답의 실사용 모델. provider 컬럼은 모델 id의 vendor prefix(실패 시 `openrouter`) | 실패 시엔 어떤 모델이 시도됐는지 OpenRouter가 알려주지 않음 |
| `bookmarks.ai_model` 과거 값(직결 시절 id)은 그대로 보존, 표시는 raw id | free text 설계 목적. 카탈로그가 없어졌으므로 라벨 매핑 제거 |
| `AI_SETTINGS_ENCRYPTION_KEY`·secret-crypto·ai_settings 관련 코드 제거 | 암호화 저장할 대상이 사라짐 (제거 전 grep으로 다른 사용처 없음 확인) |
| `@dnd-kit`과 SortableList는 유지 | 카테고리 DND가 계속 사용 |
| 마이그레이션 0008은 파일 생성만, push는 사용자가 0005~0008 일괄 실행 | 원격 DB 변경은 사용자 검토 사항 |

## File Structure

| 파일 | 변경 |
|---|---|
| `supabase/migrations/0008_openrouter_preset.sql` | **생성** — ai_settings drop, usage provider check 제거 |
| `packages/ai/src/types.ts` | `AiProviderConfig{apiKey}`, `AnalyzeOutcome{analysis, model}` 도입 |
| `packages/ai/src/providers.ts` | fetch 기반 `OpenRouterProvider` (preset 고정) |
| `packages/ai/src/schema.ts` | strict-호환 jsonSchema, confidence null 허용, completion 응답 스키마 |
| `packages/ai/package.json` | `@google/genai`·`@anthropic-ai/sdk`·`openai` 제거 |
| `packages/shared/src/index.ts` | AI 스키마 축소 (status/account), usage 이벤트 스키마는 현행 유지 |
| `apps/api/src/lib/env.ts` | `OPEN_ROUTER_API_KEY` 추가, `AI_SETTINGS_ENCRYPTION_KEY` 제거 |
| `apps/api/src/services/ai-provider.ts` | env 키 기반 싱글턴으로 전면 축소 |
| `apps/api/src/services/categorize.ts` | 단일 provider + outcome 기반 기록 |
| `apps/api/src/services/ai-usage.ts` | account 프록시 추가 (이벤트 기록은 현행 유지) |
| `apps/api/src/routes/ai.ts` | GET /ai, POST /ai/test, GET /ai/usage, GET /ai/account만 |
| `apps/api/src/lib/secret-crypto.ts` | **삭제** (+ 테스트) |
| `apps/web/src/lib/api-client.ts` | AI 함수 축소·추가 |
| `apps/web/src/routes/_authed/settings.tsx` | AiSection을 상태 카드로 축소 |
| `apps/web/src/routes/_authed/ai-usage.tsx` | 계정 사용액 카드 + activity 외부 링크 |
| `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` | aiModel raw 표시 |
| `.env.example` | OPEN_ROUTER_API_KEY 추가, 구 AI env 정리 |
| 테스트 | packages/ai·ai-provider·ai-routes·categorize·ai-usage·-settings·-ai-usage 개편 |

검증: 각 Task 마지막에 `bun run typecheck && bun run lint && bun run test`, 최종 Task에서 build 포함.

---

### Task 1: OpenRouter preset 전환 (원자적 — backend + shared + web 축소)

shared AI 스키마 개편이 전역에 파급되므로 한 커밋으로 처리한다.

**Files:** 위 표의 전부 (ai-usage 대시보드 UI 확장 제외 — Task 2)

- [ ] **Step 1: 마이그레이션 생성 (push 금지)**

Create `supabase/migrations/0008_openrouter_preset.sql`:

```sql
drop table public.ai_settings;

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_provider_check;
```

- [ ] **Step 2: 실패하는 테스트 작성 — provider 계약**

`packages/ai/src/__tests__/provider.test.ts`를 fetch mock 기반으로 교체. 핵심 단언:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiProvider, PRESET_MODEL } from "../index";

const analysis = {
  category: { type: "new" as const, name: "💻 개발", confidence: 0.9 },
  summaryTitle: "React 19 핵심 변경 사항",
  summary: "React 19의 핵심 변경을 정리한다.",
  tags: ["React", "프론트엔드", "자바스크립트"],
};

function completionResponse(content: unknown, model = "google/gemini-3.1-flash-lite-20260507") {
  return new Response(
    JSON.stringify({
      model,
      choices: [
        {
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter preset provider", () => {
  it("calls the preset with strict json_schema and returns the analysis outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse(analysis));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAiProvider({ apiKey: "or-key" });

    const outcome = await provider.categorize({
      url: "https://example.com",
      existingCategories: [],
    });

    expect(outcome.analysis).toEqual(analysis);
    expect(outcome.model).toBe("google/gemini-3.1-flash-lite-20260507");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(PRESET_MODEL);
    expect(body.max_tokens).toBe(2048);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    // strict 규칙: category의 모든 property가 required
    expect(body.response_format.json_schema.schema.properties.category.required).toEqual(
      ["type", "categoryId", "name", "confidence"],
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("parses nullable category fields from strict output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completionResponse({
          ...analysis,
          category: { type: "new", categoryId: null, name: "💻 개발", confidence: null },
        }),
      ),
    );
    const provider = createAiProvider({ apiKey: "or-key" });
    const outcome = await provider.categorize({ url: "https://example.com", existingCategories: [] });
    expect(outcome.analysis.category).toEqual({ type: "new", name: "💻 개발", confidence: 0 });
  });

  it("throws with status attached on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    const provider = createAiProvider({ apiKey: "or-key" });
    await expect(
      provider.categorize({ url: "https://example.com", existingCategories: [] }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("validates the key against GET /key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createAiProvider({ apiKey: "k" }).validateConnection()).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/key");
  });
});
```

기존 `parseAnalyzeResponse` 파싱 테스트(이모지 이름 max 16, 301자 summary 거부 등)는 유지. `openai-schema.test.ts` 삭제. Run → RED 확인.

- [ ] **Step 3: packages/ai 구현**

`types.ts`:

```ts
export interface AiProviderConfig {
  apiKey: string;
}

export interface AnalyzeOutcome {
  analysis: AnalyzeResult;
  model: string;
}

export interface AiProvider {
  categorize(input: CategorizeInput): Promise<AnalyzeOutcome>;
  validateConnection(): Promise<void>;
}
```

(`AiProviderName`, `AiProvider.name/model` 제거.)

`schema.ts`:
- `categorizeResponseSchema`의 confidence를 null 허용으로: `confidence: z.number().min(0).max(1).nullish().transform((value) => value ?? 0)` (existing/new 두 variant 모두).
- strict-호환 jsonSchema로 교체 (실측 검증된 형태):

```ts
export const jsonSchema = {
  type: "object" as const,
  properties: {
    category: {
      type: "object" as const,
      properties: {
        type: { type: "string" as const, enum: ["existing", "new", "none"] },
        categoryId: { type: ["string", "null"] as const },
        name: { type: ["string", "null"] as const },
        confidence: { type: ["number", "null"] as const },
      },
      required: ["type", "categoryId", "name", "confidence"],
      additionalProperties: false,
    },
    summaryTitle: { type: "string" as const },
    summary: { type: "string" as const },
    tags: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["category", "summaryTitle", "summary", "tags"],
  additionalProperties: false,
};
```

- completion 응답 경계 스키마:

```ts
export const openRouterCompletionSchema = z.object({
  model: z.string().default(""),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
});
```

- `systemPrompt()`에 규칙 추가: "해당 없는 필드(categoryId, name)는 null로 채운다." (strict 스키마가 필드를 강제하므로.)

`providers.ts` 전체 교체 — Step 2 테스트를 만족하는 구현:

```ts
export const PRESET_MODEL = "@preset/my-bookmark";
```

`OpenRouterProvider(apiKey)`: `categorize`는 fetch로 chat/completions 호출(`model: PRESET_MODEL`, `max_tokens: 2048`, system+user 메시지, strict json_schema, `provider: { require_parameters: true }`, `X-Title: my-bookmark` 헤더, `withTimeout` 15s signal). 비 2xx면 `status`가 붙은 에러 throw. 응답은 `openRouterCompletionSchema`로 파싱 후 content JSON → `parseAnalyzeResponse` (null이면 "AI analysis response is malformed" throw). 반환: `{ analysis, model: parsed.model || PRESET_MODEL }`. `validateConnection`은 `GET /key` 200 확인. `index.ts` export 정리(`DEFAULT_MODELS`/`DEFAULT_MODEL` 제거, `PRESET_MODEL` 추가). `package.json`에서 SDK 3종 제거 후 루트 `bun install`.

- [ ] **Step 4: shared AI 스키마 개편**

제거: `AI_MODEL_CATALOG`, `aiModelIdSchema`, `reorderAiModelsRequestSchema`(+타입), `saveAiProviderKeyRequestSchema`(+타입), `aiProviderNameSchema`(+타입).
교체/추가 (`aiUsageEventSchema`·`aiUsageQuerySchema`·`aiUsageResponseSchema`는 **현행 유지** — 단 `provider` 필드가 `aiProviderNameSchema`를 참조 중이면 `z.string()`으로 교체):

```ts
export const aiStatusResponseSchema = z.object({
  enabled: z.boolean(),
  preset: z.string(),
});
export const aiConnectionTestResponseSchema = z.object({ ok: z.boolean() });

export const aiAccountUsageResponseSchema = z.object({
  usage: z.number(),
  usageDaily: z.number(),
  usageWeekly: z.number(),
  usageMonthly: z.number(),
  limit: z.number().nullable(),
  limitRemaining: z.number().nullable(),
  isFreeTier: z.boolean(),
});
export type AiAccountUsageResponse = z.infer<typeof aiAccountUsageResponseSchema>;
```

- [ ] **Step 5: api 개편**

`lib/env.ts`: `OPEN_ROUTER_API_KEY: z.string().min(1).optional()` 추가(모든 환경 optional — 미설정 시 AI 비활성 기동, 기존 원칙), `AI_SETTINGS_ENCRYPTION_KEY` 제거. `.env.example`에 `OPEN_ROUTER_API_KEY` 추가, `AI_SETTINGS_ENCRYPTION_KEY`·구 provider 키 항목 제거.

`services/ai-provider.ts` 전면 축소:

```ts
import { type AiProvider, createAiProvider, PRESET_MODEL } from "@my-bookmark/ai";
import { appEnv } from "../lib/env";

const provider: AiProvider | null = appEnv.OPEN_ROUTER_API_KEY
  ? createAiProvider({ apiKey: appEnv.OPEN_ROUTER_API_KEY })
  : null;

if (!provider) {
  console.warn("OPEN_ROUTER_API_KEY is not set — AI categorization is disabled");
}

export function getAiProvider(): AiProvider | null {
  return provider;
}

export function getAiStatus(): { enabled: boolean; preset: string } {
  return { enabled: provider !== null, preset: PRESET_MODEL };
}

export async function testAiConnection(): Promise<boolean> {
  if (!provider) {
    return false;
  }
  try {
    await provider.validateConnection();
    return true;
  } catch (error) {
    console.warn("OpenRouter connection test failed", error);
    return false;
  }
}
```

(`createAiSettingsService`·repository·cipher 전부 삭제. `lib/secret-crypto.ts`와 그 테스트 삭제 — 삭제 전 `grep -rn "secret-crypto\|createSecretCipher" apps packages`로 다른 사용처 없음 확인.)

`services/categorize.ts`: `candidates`/`AiProviderCandidate` 제거하고 단일 provider 복귀 + outcome 기반 기록:

```ts
interface CategorizeOptions {
  db: BookmarkCategorizeDb;
  userId: string;
  bookmarkId: string;
  provider: AiProvider | null;
  recordUsage?: (event: AiUsageEventInput) => Promise<void>;
  metadataFetcher?: (url: string) => Promise<PageMetadata>;
}
```

provider 호출부: 시도 1회 — 성공 시 `recordUsage`에 `{ provider: vendorOf(outcome.model), model: outcome.model, status: "success", errorCode: null, durationMs }` 기록 후 `applyCategorizeResult(..., outcome.analysis, outcome.model)`. 실패 시 `{ provider: "openrouter", model: PRESET_MODEL, status: "failed", errorCode: extractErrorCode(error), durationMs }` 기록 후 `markFailed`. `vendorOf(model)`은 `model.split("/")[0] || "openrouter"`. `AiUsageEventInput`은 현행 유지(provider 타입만 `string`으로). `applyCategorizeResult`/`markDone` 시그니처는 유지(analysis + aiModel).

`services/ai-usage.ts`: 이벤트 기록·조회는 **현행 유지**. **추가**: OpenRouter 계정 사용액 프록시:

```ts
const openRouterKeyResponseSchema = z.object({
  data: z.object({
    usage: z.number(),
    usage_daily: z.number(),
    usage_weekly: z.number(),
    usage_monthly: z.number(),
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    is_free_tier: z.boolean(),
  }),
});

export async function fetchAccountUsage(apiKey: string): Promise<AiAccountUsageResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new HttpError(502, API_ERROR_CODES.INTERNAL, "OpenRouter key lookup failed");
  }
  const parsed = openRouterKeyResponseSchema.parse(await response.json());
  return aiAccountUsageResponseSchema.parse({
    usage: parsed.data.usage,
    usageDaily: parsed.data.usage_daily,
    usageWeekly: parsed.data.usage_weekly,
    usageMonthly: parsed.data.usage_monthly,
    limit: parsed.data.limit,
    limitRemaining: parsed.data.limit_remaining,
    isFreeTier: parsed.data.is_free_tier,
  });
}
```

`routes/ai.ts` 개편 — 서비스가 순수 함수가 됐으므로 라우터 팩토리 시그니처도 단순화:

```ts
router.get("/ai", ...)          // aiStatusResponseSchema.parse(getAiStatus())
router.post("/ai/test", ...)    // { ok: await testAiConnection() }
router.get("/ai/usage", ...)    // 기존 유지
router.get("/ai/account", ...)  // env 키 없으면 400, 있으면 fetchAccountUsage(appEnv.OPEN_ROUTER_API_KEY)
```

(`/ai/keys/:provider`, `/ai/model`, `/ai/model-order`, `/ai/test/:provider` 삭제.)

`routes/bookmarks.ts`: `chainResolver` 제거 → `providerResolver?: () => AiProvider | null = getAiProvider`로 단순화, `categorize({ db, userId, bookmarkId, provider, recordUsage })`.

테스트: `ai-provider.test.ts`(서비스 테스트를 env 유무에 따른 status/test로 대폭 축소 — env mock은 `vi.mock("../lib/env", ...)`), `ai-routes.test.ts`(새 4개 라우트 + account 프록시 fetch mock), `categorize.test.ts`(candidates → 단일 provider·outcome mock, 성공 이벤트의 model이 실사용 모델임을 단언), `ai-usage.test.ts`(fetchAccountUsage 성공/502 추가), `bookmark-security.test.ts` 시그니처 반영, `secret-crypto.test.ts` 삭제, `env.test.ts`에서 AI_SETTINGS_ENCRYPTION_KEY 제거 반영.

- [ ] **Step 6: web 축소**

`api-client.ts`: `saveAiProviderKey`/`deleteAiProviderKey`/`testAiProviderConnection`/`reorderAiModels` 삭제. `testAiConnection()`(POST /api/ai/test), `getAiAccountUsage()`(GET /api/ai/account) 추가. `getAiStatus`는 새 스키마로.

`settings.tsx` `AiSection` 전면 축소 — 키 입력/모델 DND 삭제:

```tsx
export function AiSection() {
  const aiQuery = useQuery({ queryKey: ["ai"], queryFn: getAiStatus });
  const testMutation = useMutation({
    mutationFn: testAiConnection,
    onSuccess: (result) =>
      result.ok
        ? toast.success("OpenRouter 연결에 성공했어요")
        : toast.error("OpenRouter 키를 확인해 주세요"),
    onError: () => toast.error("연결 테스트를 완료하지 못했어요"),
  });

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="font-bold">AI 분류</h2>
      <p className="mt-1 text-sm text-zinc-500">
        분류는 OpenRouter preset이 담당합니다. 모델·폴백·파라미터는
        openrouter.ai 대시보드에서 관리하세요.
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium">{aiQuery.data?.preset ?? "@preset/my-bookmark"}</p>
          <p className="text-xs text-zinc-500">
            {aiQuery.data?.enabled
              ? "서버에 OpenRouter 키가 설정되어 있어요"
              : "서버 env에 OPEN_ROUTER_API_KEY가 필요해요"}
          </p>
        </div>
        <span className={aiQuery.data?.enabled ? "text-xs text-green-600" : "text-xs text-red-600"}>
          {aiQuery.data?.enabled ? "활성" : "비활성"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="btn-secondary"
          disabled={!aiQuery.data?.enabled || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          type="button"
        >
          {testMutation.isPending ? "확인 중…" : "연결 테스트"}
        </button>
        <Link className="inline-flex items-center gap-1 text-sm font-medium text-blue-600" to="/ai-usage">
          사용량 대시보드 <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
```

(사용하지 않게 된 import·상수 정리. `-settings.test.tsx`의 AI 관련 테스트를 새 UI에 맞게 교체: 활성/비활성 표시, 연결 테스트 성공 토스트, 대시보드 링크 href. 카테고리 DND 테스트는 유지.)

`bookmark-dialogs.tsx`: `AI_MODEL_CATALOG` 라벨 조회 제거, `bookmark.aiModel` raw 표시. `-index.test.tsx`의 편집 모달 모델 테스트를 raw id 기준으로 수정. `ai-usage.tsx`의 `modelLabel`은 `AI_MODEL_CATALOG` 의존 제거(raw id 반환) — 대시보드 UI 확장은 Task 2.

- [ ] **Step 7: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
잔여 참조 확인:
`grep -rn "AI_MODEL_CATALOG\|aiModelIdSchema\|model_order\|modelOrder\|reorderAiModels\|secret-crypto\|AI_SETTINGS_ENCRYPTION_KEY\|ai_settings" packages apps --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v migrations` → 매치 없음.

```bash
git add -A
git commit -m "feat: AI 분류를 OpenRouter preset 단일 호출로 전환"
```

- [ ] **Step 8: 실키 스모크 (자동화 가능 범위)**

`.env`의 실키로 provider 단독 스모크(서버 기동 불필요, DB 불필요): scratchpad에 임시 스크립트를 만들어 `createAiProvider({ apiKey: process.env.OPEN_ROUTER_API_KEY! }).categorize({ url: "https://react.dev", title: "React", existingCategories: [] })`를 1회 실행하고 outcome.analysis가 zod를 통과하며 model이 채워지는지 확인. 스크립트는 저장소에 커밋하지 않고, 키 값은 출력하지 않는다. 결과를 PROGRESS 수동확인 항목에 기록.

---

### Task 2: 대시보드에 OpenRouter 계정 사용액 카드 추가

**Files:**
- Modify: `apps/web/src/routes/_authed/ai-usage.tsx`, `apps/web/src/routes/_authed/-ai-usage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`-ai-usage.test.tsx`: api-client mock에 `getAiAccountUsage` 추가. 신규 단언: (a) 계정 사용액 카드가 오늘/이번 주/이번 달 USD를 표시, (b) openrouter.ai activity 외부 링크(`https://openrouter.ai/activity`)가 존재, (c) account 조회 실패 시 카드 없이 나머지 섹션은 정상 렌더. Run → RED.

- [ ] **Step 2: 구현**

`ai-usage.tsx`:
- 상단에 계정 카드 추가 — `useQuery({ queryKey: ["aiAccount"], queryFn: getAiAccountUsage, retry: false })`, 실패 시 카드 숨김(개인 대시보드라 조용히 생략).
- 카드 내용: `오늘 / 이번 주 / 이번 달` 3개 수치(USD, `formatUsd`), free tier 여부, `limit`이 있으면 잔여 한도 표시.
- `formatUsd(value: number)` → `"$" + value.toFixed(4)`.
- 카드 하단(또는 페이지 헤더)에 외부 링크: `<a href="https://openrouter.ai/activity" target="_blank" rel="noreferrer">모델별 비용 상세는 OpenRouter Activity에서 →</a>` — 모델별·일별 비용 집계는 로컬에 저장하지 않으므로 여기로 안내.
- 기존 섹션(모델별 호출 성공/실패, 일별 호출, 최근 이벤트)은 그대로.

- [ ] **Step 3: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`

```bash
git add -A
git commit -m "feat: AI 대시보드에 OpenRouter 계정 사용액 카드 추가"
```

---

### Task 3: 문서 동기화 + 전체 검증 + PROGRESS 갱신 (플랜 #1·#2 문서 잔여분 통합)

- [ ] **Step 1: docs 갱신**

- `docs/02-database.md`: categories color 제거, bookmarks.ai_model, ai_usage_events, ai_settings 테이블 삭제 반영.
- `docs/03-api.md`: 카테고리(color 제거, PUT /order), AI 최종 API 4개(GET /ai, POST /ai/test, GET /ai/usage, GET /ai/account), bookmark 응답 aiModel.
- `docs/05-ai.md`: OpenRouter preset 아키텍처로 재작성 — preset `@preset/my-bookmark` 단일 호출, strict json_schema 규칙(전부 required + nullable, max_tokens 명시), 폴백·모델 관리는 openrouter.ai, 토큰·비용은 로컬 미저장(openrouter.ai activity 안내), summary·이모지 카테고리 규칙 유지.
- `docs/01-architecture.md`·`.env.example`: `OPEN_ROUTER_API_KEY` 환경변수 문서화, 구 AI env 제거.

- [ ] **Step 2: 전체 검증 루프**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`

- [ ] **Step 3: PROGRESS.md 갱신 + Commit**

결정 로그에 이 플랜 상단 결정 사항 표를 날짜와 함께 기록. "사용자 확인 필요"에 기록: (1) `bun x supabase db push --dry-run` → `bun x supabase db push`로 **0005~0008 일괄 적용**, (2) push 후 dev 스택에서 mode=ai 등록 → 분류 성공·편집 모달 실사용 모델 표시·대시보드(이벤트 집계+계정 카드) 확인, (3) 카테고리 DND 터치(iOS), (4) preset 폴백은 openrouter.ai에서 preset에 폴백 모델 구성 시 자연 관찰.

```bash
git add -A
git commit -m "docs: OpenRouter preset 전환 반영"
```

---

## 주의사항 (구현 세션 필독)

- **strict json_schema 규칙을 임의로 되돌리지 말 것** — nullable-전부-required와 `max_tokens: 2048`은 실측 400/402의 직접 대응이다.
- OpenRouter 응답 형태가 계획과 다르면 실측(Task 1 Step 8 스모크)으로 확인해 맞추고 이탈로 보고.
- **마이그레이션 push 금지.** 실키는 `.env`의 `OPEN_ROUTER_API_KEY`를 사용하되 키 값을 로그·보고에 출력하지 말 것.
- `any`/`@ts-ignore` 금지, 테스트 skip 금지, 검증 실패 상태로 커밋 금지.
