# AI 모델 폴백 순서(DND) + 분류 모델 노출 + 사용량 대시보드 + 카테고리 DND Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 분류가 우선순위 모델 체인으로 동작하고(실패 시 다음 모델로 폴백), 어떤 모델이 분류했는지 노출하며, 모델별 사용량 대시보드를 제공한다. 모델·카테고리 순서는 DND로 관리한다.

**Architecture:** `ai_settings.model_order`(text[])가 실행 우선순위의 원본이다. 분류는 체인의 각 후보를 순서대로 시도하고, 시도마다 `ai_usage_events`에 성공/실패를 기록하며, 성공한 모델을 `bookmarks.ai_model`에 남긴다. 기존 단일 `PUT /api/ai/model`(사용 모델 선택)은 제거하고 `PUT /api/ai/model-order`로 대체한다 — 우선순위 리스트의 첫 항목이 곧 기본 모델이다. DND는 `@dnd-kit`(터치+키보드 지원)을 web에 추가해 공용 `SortableList` 컴포넌트로 모델·카테고리 양쪽에 쓴다.

**Tech Stack:** 기존 스택 + `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (apps/web 신규 의존성 — 사용자 DND 요청의 직접 수단).

**선행 조건:** 플랜 #1(`2026-07-12-category-icon-reorder-ai-summary.md`) Task 1~6 완료 상태. 플랜 #1의 Task 7(문서/PROGRESS)은 이 플랜의 마지막 Task에 **통합**한다 (docs/05-ai를 양쪽이 모두 수정하므로).

---

## 사용자 요구사항 (스펙)

1. **AI 모델 동작 순서**: 특정 모델이 429 등으로 실패하면 다음 순서의 모델이 동작. 순서 관리는 DND.
2. **분류 모델 노출**: AI 분류된 북마크의 편집 모달에서 어떤 모델로 분류됐는지 표시.
3. **AI 대시보드**: 언제 어떤 모델을 얼마나 사용했는지. 설정 페이지에서 이동 가능.
4. **카테고리 순서도 DND로 변경** (기존 위/아래 버튼에 추가).

## 결정 사항 (구현 중 재논의 금지 — PROGRESS 결정 로그에 기록할 것)

| 결정 | 이유 |
|---|---|
| `model_order`(text[])가 실행 순서의 단일 원본. 기존 `provider`/`model` 컬럼은 첫 항목으로 동기화해 유지 | 0003 마이그레이션의 provider↔model check 제약과 기존 코드(testConnection 등)를 깨지 않으면서 단일 쓰기 경로 확보 |
| `PUT /api/ai/model` + `selectModel` + 모델 select UI 제거, `PUT /api/ai/model-order`로 대체 | "활성 모델 선택"과 "우선순위 1번"이 공존하면 두 개의 진실이 생긴다. 리스트 상단 = 기본 모델 |
| 유효 순서(effective order) = 저장된 order 중 키가 설정된 provider의 카탈로그 모델 + 누락된 사용 가능 모델을 뒤에 append | 키 추가/삭제·카탈로그 변경에도 순서가 안정적으로 유지 |
| 폴백은 provider 호출 실패(429·타임아웃·5xx·응답 파싱 실패 등 **모든 throw**)에서 다음 후보로 진행 | 에러 종류를 세분화할 가치가 낮다(개인 서비스). 모든 후보 실패 시에만 `ai_status='failed'` |
| 시도마다 `ai_usage_events`에 1행 기록 (성공/실패, error_code, duration_ms). 기록 실패는 분류를 실패시키지 않음(console.warn) | "언제 어떤 모델을 얼마나"의 원천 데이터. 로깅은 부수 기능 |
| `bookmarks.ai_model`은 free text(스키마 `z.string().nullable()`) | 카탈로그는 계속 바뀐다. 과거 분류 기록이 카탈로그 enum에 묶이면 안 됨 |
| 사용량 API는 원본 이벤트 목록 반환(`GET /api/ai/usage?days=`, 최대 1000행), 집계는 클라이언트 | "언제"의 일별 집계를 사용자 로컬 타임존(KST)으로 정확히 하려면 클라이언트 집계가 맞다. 개인 규모라 행 수 문제 없음 |
| DND는 `@dnd-kit` 채택 (신규 의존성) | iOS PWA라 터치 필수, 키보드 접근성 내장. 자체 pointer 구현은 리스크 대비 이득 없음 |
| 카테고리·모델 리스트 모두 **드래그 핸들 + 기존 위/아래 버튼 병행** | 버튼은 jsdom에서 검증 가능한 경로이자 접근성 폴백. DND 자체는 핸들 존재 + 헬퍼 단위 테스트로 검증하고 실 드래그는 수동 확인 |
| 대시보드 차트는 라이브러리 없이 CSS bar | 의존성 최소화. 개인 대시보드 수준에 충분 |
| 마이그레이션 0006(model_order·ai_model)/0007(ai_usage_events)은 **push하지 않고 파일만 생성** | 원격 DB 변경은 사용자가 0005와 함께 일괄 검토 후 직접 push |

## File Structure

| 파일 | 변경 |
|---|---|
| `supabase/migrations/0006_ai_model_order.sql` | **생성** — ai_settings.model_order + backfill, bookmarks.ai_model |
| `supabase/migrations/0007_ai_usage_events.sql` | **생성** — 사용 이벤트 테이블 + RLS |
| `packages/shared/src/index.ts` | bookmarkSchema.aiModel, aiStatusResponse.modelOrder, reorderAiModelsRequestSchema, aiUsage 스키마, selectAiModelRequestSchema 제거 |
| `packages/ai/src/types.ts`, `providers.ts` | `AiProvider.model` 노출 |
| `apps/api/src/services/ai-provider.ts` | model_order 로딩, `getProviderChain`, `reorderModels`(selectModel 대체) |
| `apps/api/src/services/categorize.ts` | 후보 체인 폴백 루프, ai_model 기록, usage recorder 훅 |
| `apps/api/src/services/ai-usage.ts` | **생성** — 이벤트 기록/조회 |
| `apps/api/src/routes/ai.ts` | PUT /ai/model 제거, PUT /ai/model-order, GET /ai/usage |
| `apps/api/src/routes/bookmarks.ts` | 체인 resolver 사용 + recorder 배선 |
| `apps/api/src/lib/db-mappers.ts` | ai_model 매핑 |
| `apps/web/src/lib/api-client.ts` | reorderAiModels, getAiUsage 추가 / selectAiModel 제거 |
| `apps/web/src/routes/_authed/-components/sortable-list.tsx` | **생성** — @dnd-kit 공용 세로 정렬 리스트 |
| `apps/web/src/routes/_authed/settings.tsx` | 모델 select → DND 우선순위 리스트, 카테고리 DND, 대시보드 링크 |
| `apps/web/src/routes/_authed/ai-usage.tsx` | **생성** — 대시보드 페이지 |
| `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` | 편집 모달에 분류 모델 표시 |
| 테스트 | ai-provider/ai-routes/categorize 테스트 개편, ai-usage/-ai-usage/-sortable 신규, Bookmark·AiStatus fixture들에 필드 추가 |

모든 커밋 전 공통 검증: `bun run typecheck && bun run lint && bun run test`.

---

### Task 1: 모델 체인 폴백 실행 + 분류 모델 기록 (backend + 편집 모달 노출)

**Files:**
- Create: `supabase/migrations/0006_ai_model_order.sql`
- Modify: `packages/shared/src/index.ts`, `packages/ai/src/types.ts`, `packages/ai/src/providers.ts`
- Modify: `apps/api/src/services/ai-provider.ts`, `apps/api/src/services/categorize.ts`, `apps/api/src/routes/bookmarks.ts`, `apps/api/src/lib/db-mappers.ts`
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Test: `apps/api/src/__tests__/categorize.test.ts`, `apps/api/src/__tests__/ai-provider.test.ts`, fixture를 쓰는 모든 테스트

- [ ] **Step 1: 마이그레이션 생성 (push 금지)**

Create `supabase/migrations/0006_ai_model_order.sql`:

```sql
alter table public.ai_settings
  add column model_order text[] not null default '{}';

update public.ai_settings
set model_order = array[model];

alter table public.bookmarks
  add column ai_model text;
```

- [ ] **Step 2: 실패하는 테스트 작성 — 폴백 루프**

`apps/api/src/__tests__/categorize.test.ts`의 `describe("categorizeBookmark")`에 추가. 기존 테스트의 `provider:` 옵션은 Step 4에서 `candidates:` 배열로 바뀌므로 함께 수정한다 (기존 단일 실패 테스트는 `candidates: [failingCandidate]`로 변환).

```ts
const successResult: AnalyzeResult = {
  category: { type: "existing", categoryId: "cat-dev", confidence: 0.9 },
  summaryTitle: "웹 접근성 실전 안내",
  summary: "핵심 요약.",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
};

function candidate(
  name: "gemini" | "anthropic" | "openai",
  model: string,
  categorize: AiProvider["categorize"],
): AiProviderCandidate {
  return {
    provider: name,
    model,
    instance: { name, model, categorize, validateConnection: vi.fn() },
  };
}

it("falls back to the next model when the first attempt throws", async () => {
  const db = new FakeDb();
  const events: { model: string; status: string }[] = [];
  const first = candidate(
    "gemini",
    "gemini-flash-lite-latest",
    vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 })),
  );
  const second = candidate(
    "anthropic",
    "claude-haiku-4-5",
    vi.fn().mockResolvedValue(successResult),
  );

  await categorizeBookmark({
    db,
    userId: "user",
    bookmarkId: "bookmark",
    candidates: [first, second],
    recordUsage: async (event) => {
      events.push({ model: event.model, status: event.status });
    },
    metadataFetcher: vi.fn().mockResolvedValue({
      title: null,
      description: null,
      siteName: null,
      faviconUrl: null,
      ogImageUrl: null,
    }),
  });

  expect(db.bookmark).toMatchObject({
    ai_status: "done",
    ai_model: "claude-haiku-4-5",
    category_id: "cat-dev",
  });
  expect(events).toEqual([
    { model: "gemini-flash-lite-latest", status: "failed" },
    { model: "claude-haiku-4-5", status: "success" },
  ]);
});

it("marks failed only after every candidate throws", async () => {
  const db = new FakeDb();
  const failing = vi.fn().mockRejectedValue(new Error("boom"));
  await categorizeBookmark({
    db,
    userId: "user",
    bookmarkId: "bookmark",
    candidates: [
      candidate("gemini", "gemini-flash-lite-latest", failing),
      candidate("openai", "gpt-4o-mini", failing),
    ],
    metadataFetcher: vi.fn().mockResolvedValue({
      title: null,
      description: null,
      siteName: null,
      faviconUrl: null,
      ogImageUrl: null,
    }),
  });
  expect(db.bookmark.ai_status).toBe("failed");
  expect(failing).toHaveBeenCalledTimes(2);
});
```

`FakeDb.bookmark`에 `ai_model: null as string | null,` 필드를 추가한다. `AiProviderCandidate`는 Step 4에서 `services/categorize.ts`가 export한다 (import 추가).

- [ ] **Step 3: 공유 스키마·AI 패키지 수정**

`packages/ai/src/types.ts`의 `AiProvider`에 model 노출:

```ts
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  categorize(input: CategorizeInput): Promise<AnalyzeResult>;
  validateConnection(): Promise<void>;
}
```

`packages/ai/src/providers.ts`의 세 클래스에서 `private readonly model: string` → `readonly model: string` (constructor 파라미터 프로퍼티의 `private` 제거). provider.test.ts의 fake provider 객체에도 `model: "fake-model"` 추가.

`packages/shared/src/index.ts`:

```ts
export const bookmarkSchema = z.object({
  // ...기존 필드...
  aiStatus: aiStatusSchema,
  aiModel: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
```

`aiStatusResponseSchema`에 `modelOrder: z.array(aiModelIdSchema),` 추가.

```ts
export const reorderAiModelsRequestSchema = z
  .object({
    models: z.array(aiModelIdSchema).min(1).max(AI_MODEL_CATALOG.length),
  })
  .refine((value) => new Set(value.models).size === value.models.length, {
    message: "models must be unique",
    path: ["models"],
  });
export type ReorderAiModelsRequest = z.infer<
  typeof reorderAiModelsRequestSchema
>;
```

`bookmarkSchema` 변경으로 깨지는 fixture 전부에 `aiModel: null` 추가:
`grep -rn "aiStatus:" apps/web/src apps/api/src --include="*.test.*"`로 Bookmark 객체 fixture를 찾고(웹 `-index.test.tsx`의 bookmark 등), api 쪽 `bookmarkRow(...)` DB fixture에는 `ai_model: null`을 추가한다. `db-mappers.ts`의 `BookmarkDbRow`에 `ai_model: string | null`, `mapBookmark`에 `aiModel: row.ai_model,` 추가.

`aiStatusResponseSchema` 변경으로 `-settings.test.tsx`의 aiStatus fixture 등에 `modelOrder: [...]` 추가 (typecheck가 알려준다).

- [ ] **Step 4: categorize 폴백 루프 구현**

`apps/api/src/services/categorize.ts`:

```ts
export interface AiProviderCandidate {
  provider: "gemini" | "anthropic" | "openai";
  model: string;
  instance: AiProvider;
}

export interface AiUsageEventInput {
  provider: AiProviderCandidate["provider"];
  model: string;
  bookmarkId: string;
  status: "success" | "failed";
  errorCode: string | null;
  durationMs: number;
}

interface CategorizeOptions {
  db: BookmarkCategorizeDb;
  userId: string;
  bookmarkId: string;
  candidates: AiProviderCandidate[];
  recordUsage?: (event: AiUsageEventInput) => Promise<void>;
  metadataFetcher?: (url: string) => Promise<PageMetadata>;
}
```

`categorizeBookmark` 본문의 provider 호출부를 교체 (메타데이터 수집·`markFailed`·기존 헬퍼는 유지):

```ts
    if (candidates.length === 0) {
      await markFailed(db, userId, bookmarkId);
      return;
    }

    const input = {
      url: bookmark.url,
      title,
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
      existingCategories: categories,
    };

    for (const candidate of candidates) {
      const startedAt = Date.now();
      let result: AnalyzeResult;
      try {
        result = await candidate.instance.categorize(input);
      } catch (error) {
        console.warn(
          `AI model ${candidate.model} failed, trying next candidate`,
          error,
        );
        await recordUsage?.({
          provider: candidate.provider,
          model: candidate.model,
          bookmarkId,
          status: "failed",
          errorCode: extractErrorCode(error),
          durationMs: Date.now() - startedAt,
        });
        continue;
      }
      await recordUsage?.({
        provider: candidate.provider,
        model: candidate.model,
        bookmarkId,
        status: "success",
        errorCode: null,
        durationMs: Date.now() - startedAt,
      });
      await applyCategorizeResult(
        db,
        userId,
        bookmarkId,
        categories,
        result,
        candidate.model,
      );
      return;
    }
    await markFailed(db, userId, bookmarkId);
```

```ts
function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return String(status);
    }
    if (error instanceof Error && error.name !== "Error") {
      return error.name.slice(0, 40);
    }
  }
  return "unknown";
}
```

`applyCategorizeResult`와 `markDone`에 `aiModel: string` 마지막 인자를 추가하고 markDone update에 `ai_model: aiModel,` 포함. 기존 categorize 테스트의 `applyCategorizeResult(...)` 호출들에 모델 인자(예: `"gemini-flash-lite-latest"`)를 추가하고, 첫 테스트의 기대 update에 `ai_model: "gemini-flash-lite-latest",`를 추가한다. `recordUsage`의 throw는 폴백을 깨지 않도록 호출부가 아니라 **recorder 구현(Task 2)**에서 삼킨다 — categorize는 recorder가 던지지 않는다고 가정해도 되지만, 안전하게 `await recordUsage?.(...).catch(...)` 대신 Task 2의 no-throw recorder 계약을 따른다.

- [ ] **Step 5: 서비스에 체인 추가**

`apps/api/src/services/ai-provider.ts`:

- `aiSettingsRowSchema`에 `model_order: z.array(z.string()).default([]),` 추가 (`AiSettingsValues`에 자동 포함). `emptyValues`에 `model_order: []`.
- 유효 순서 계산과 체인 (파일 상단에 `AI_MODEL_CATALOG` import — `@my-bookmark/shared`):

```ts
function effectiveModelOrder(values: AiSettingsValues): AiModelId[] {
  const usable = AI_MODEL_CATALOG.filter(
    (item) => values[keyColumns[item.provider]] !== null,
  ).map((item) => item.model as AiModelId);
  const stored = values.model_order.filter((model): model is AiModelId =>
    usable.some((usableModel) => usableModel === model),
  );
  const missing = usable.filter((model) => !stored.includes(model));
  return [...stored, ...missing];
}
```

- `AiSettingsService` 인터페이스: `selectModel` 제거 대신 이 Task에서는 **유지**(라우트 제거는 Task 3), 추가만 한다:

```ts
  getProviderChain(userId: string): Promise<AiProviderCandidate[]>;
  reorderModels(
    userId: string,
    input: ReorderAiModelsRequest,
  ): Promise<AiStatusResponse>;
```

구현 (providerCache는 `Map<string, AiProviderCandidate[]>`로 교체하고 `getProvider`는 체인의 첫 항목을 반환하도록 축소 유지):

```ts
    async getProviderChain(userId) {
      const cached = providerCache.get(userId);
      if (cached) {
        return cached;
      }
      const values = await loadValues(userId);
      const chain = effectiveModelOrder(values).flatMap((model) => {
        const item = AI_MODEL_CATALOG.find((entry) => entry.model === model);
        const encryptedKey = item ? values[keyColumns[item.provider]] : null;
        if (!item || !encryptedKey) {
          return [];
        }
        return [
          {
            provider: item.provider,
            model,
            instance: providerFactory({
              provider: item.provider,
              model,
              apiKey: cipher.decrypt(encryptedKey),
            }),
          },
        ];
      });
      providerCache.set(userId, chain);
      return chain;
    },
    async reorderModels(userId, input) {
      const values = await loadValues(userId);
      const usable = effectiveModelOrder(values);
      const sameSet =
        input.models.length === usable.length &&
        input.models.every((model) => usable.includes(model));
      if (!sameSet) {
        throw new HttpError(
          400,
          API_ERROR_CODES.VALIDATION_ERROR,
          "models must contain every usable model exactly once",
        );
      }
      const first = AI_MODEL_CATALOG.find(
        (item) => item.model === input.models[0],
      );
      if (!first) {
        throw new HttpError(400, API_ERROR_CODES.VALIDATION_ERROR, "Unknown model");
      }
      values.model_order = [...input.models];
      values.provider = first.provider;
      values.model = first.model;
      const saved = await repository.save(userId, values);
      providerCache.delete(userId);
      const { user_id: _userId, ...savedValues } = saved;
      return toStatus(savedValues);
    },
```

- `toStatus`에 `modelOrder: effectiveModelOrder(values),` 추가, `enabled`는 `effectiveModelOrder(values).length > 0`로 교체.
- `getProvider(userId)`는 `(await this.getProviderChain(userId))[0]?.instance ?? null` 형태로 유지(호출부는 Step 6에서 체인으로 교체하므로 남는 사용처가 없으면 제거해도 된다 — 제거 시 인터페이스·테스트도 함께).
- export를 추가한다:

```ts
export function getAiProviderChain(
  userId: string,
): Promise<AiProviderCandidate[]> {
  return aiSettingsService.getProviderChain(userId);
}
```

`apps/api/src/__tests__/ai-provider.test.ts`에 테스트 추가: (a) 두 provider 키 설정 + model_order 저장 시 체인이 그 순서를 따르고, (b) 키 없는 provider 모델은 체인에서 제외되며, (c) `reorderModels`가 usable 전체 permutation이 아니면 400, (d) 성공 시 provider/model 컬럼이 첫 항목으로 동기화. 기존 repository mock의 행에 `model_order: []`를 추가한다.

- [ ] **Step 6: bookmarks 라우트를 체인으로 전환**

`apps/api/src/routes/bookmarks.ts`의 `categorizeBookmarkForUser`를 교체:

```ts
import { getAiProviderChain } from "../services/ai-provider";
import { recordAiUsage } from "../services/ai-usage"; // Task 2에서 생성 — 이 Task에서는 임시로 no-op을 인라인 정의

interface CategorizeBookmarkForUserOptions {
  db: Parameters<typeof categorizeBookmark>[0]["db"];
  userId: string;
  bookmarkId: string;
  chainResolver?: typeof getAiProviderChain;
  categorize?: typeof categorizeBookmark;
}

export async function categorizeBookmarkForUser({
  db,
  userId,
  bookmarkId,
  chainResolver = getAiProviderChain,
  categorize = categorizeBookmark,
}: CategorizeBookmarkForUserOptions): Promise<void> {
  let candidates: AiProviderCandidate[] = [];
  try {
    candidates = await chainResolver(userId);
  } catch (error) {
    console.warn("AI provider credentials could not be loaded", error);
  }
  await categorize({ db, userId, bookmarkId, candidates });
}
```

(이 Task에서는 `recordUsage`를 아직 배선하지 않는다 — Task 2에서 추가. import 줄도 Task 2에서.)

- [ ] **Step 7: 편집 모달에 분류 모델 표시**

`apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`의 `EditBookmarkDialog` 폼 안, `<TagInput …/>` 아래에 추가:

```tsx
        {bookmark.aiModel ? (
          <p className="text-xs text-zinc-500">
            AI 분류 모델:{" "}
            {AI_MODEL_CATALOG.find((item) => item.model === bookmark.aiModel)
              ?.label ?? bookmark.aiModel}
          </p>
        ) : null}
```

`AI_MODEL_CATALOG`를 `@my-bookmark/shared`에서 import. `-index.test.tsx`에 테스트 추가:

```tsx
  it("shows which AI model classified the bookmark in the edit dialog", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <EditBookmarkDialog
          bookmark={{ ...bookmark, aiModel: "claude-haiku-4-5" }}
          categories={[]}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Claude Haiku 4.5/)).toBeTruthy();
  });
```

- [ ] **Step 8: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: AI 분류를 모델 우선순위 체인 폴백으로 전환하고 분류 모델 기록"
```

---

### Task 2: 사용량 이벤트 로깅 + 조회 API

**Files:**
- Create: `supabase/migrations/0007_ai_usage_events.sql`
- Create: `apps/api/src/services/ai-usage.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/routes/ai.ts`, `apps/api/src/routes/bookmarks.ts`
- Test: Create `apps/api/src/__tests__/ai-usage.test.ts`

- [ ] **Step 1: 마이그레이션 생성 (push 금지)**

Create `supabase/migrations/0007_ai_usage_events.sql`:

```sql
create table public.ai_usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null check (provider in ('gemini', 'anthropic', 'openai')),
  model       text not null,
  bookmark_id uuid references public.bookmarks(id) on delete set null,
  status      text not null check (status in ('success', 'failed')),
  error_code  text,
  duration_ms int,
  created_at  timestamptz not null default now()
);
create index ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

alter table public.ai_usage_events enable row level security;

create policy "owner_all" on public.ai_usage_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

- [ ] **Step 2: shared 스키마 추가**

`packages/shared/src/index.ts`:

```ts
export const aiUsageStatusSchema = z.enum(["success", "failed"]);
export const aiUsageEventSchema = z.object({
  id: uuidSchema,
  provider: aiProviderNameSchema,
  model: z.string(),
  bookmarkId: uuidSchema.nullable(),
  status: aiUsageStatusSchema,
  errorCode: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
});
export const aiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export const aiUsageResponseSchema = z.object({
  days: z.number().int(),
  items: z.array(aiUsageEventSchema),
});
export type AiUsageEvent = z.infer<typeof aiUsageEventSchema>;
export type AiUsageResponse = z.infer<typeof aiUsageResponseSchema>;
```

- [ ] **Step 3: 실패하는 테스트 작성**

Create `apps/api/src/__tests__/ai-usage.test.ts` — supabase mock은 `bookmark-tags.test.ts` 패턴을 따른다:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createAiUsageRecorder,
  listAiUsageEvents,
} from "../services/ai-usage";

const userId = "11111111-1111-4111-8111-111111111111";

describe("ai usage recorder", () => {
  it("inserts one row per attempt", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };
    const record = createAiUsageRecorder(db, userId);

    await record({
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      bookmarkId: "22222222-2222-4222-8222-222222222222",
      status: "failed",
      errorCode: "429",
      durationMs: 1200,
    });

    expect(db.from).toHaveBeenCalledWith("ai_usage_events");
    expect(insert).toHaveBeenCalledWith({
      user_id: userId,
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      bookmark_id: "22222222-2222-4222-8222-222222222222",
      status: "failed",
      error_code: "429",
      duration_ms: 1200,
    });
  });

  it("never throws even when the insert fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const insert = vi.fn().mockRejectedValue(new Error("db down"));
    const db = { from: vi.fn(() => ({ insert })) };
    const record = createAiUsageRecorder(db, userId);

    await expect(
      record({
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        bookmarkId: null,
        status: "success",
        errorCode: null,
        durationMs: 800,
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("listAiUsageEvents", () => {
  it("queries the user window ordered by created_at desc with a cap", async () => {
    const rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        user_id: userId,
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        bookmark_id: null,
        status: "success",
        error_code: null,
        duration_ms: 700,
        created_at: "2026-07-12T10:00:00.000Z",
      },
    ];
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
    const order = vi.fn(() => ({ limit }));
    const gte = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ gte }));
    const select = vi.fn(() => ({ eq }));
    const db = { from: vi.fn(() => ({ select })) };

    const items = await listAiUsageEvents(db, userId, 30);

    expect(limit).toHaveBeenCalledWith(1000);
    expect(items[0]).toMatchObject({
      model: "gemini-flash-lite-latest",
      status: "success",
      durationMs: 700,
    });
  });
});
```

Run: `bun run test` → 신규 파일 전체 FAIL(모듈 없음) 확인.

- [ ] **Step 4: 서비스 구현**

Create `apps/api/src/services/ai-usage.ts`:

```ts
import { type AiUsageEvent, aiUsageEventSchema } from "@my-bookmark/shared";
import type { AiUsageEventInput } from "./categorize";

interface UsageInsertDb {
  from(table: "ai_usage_events"): {
    insert(values: Record<string, unknown>): PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
}

interface UsageRow {
  id: string;
  provider: "gemini" | "anthropic" | "openai";
  model: string;
  bookmark_id: string | null;
  status: "success" | "failed";
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface UsageSelectDb {
  from(table: "ai_usage_events"): {
    select(columns: string): {
      eq(
        field: string,
        value: string,
      ): {
        gte(
          field: string,
          value: string,
        ): {
          order(
            field: string,
            options: { ascending: boolean },
          ): {
            limit(count: number): PromiseLike<{
              data: UsageRow[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
}

// 기록 실패는 분류를 깨면 안 된다 — 절대 throw하지 않는다.
export function createAiUsageRecorder(db: unknown, userId: string) {
  return async (event: AiUsageEventInput): Promise<void> => {
    try {
      const { error } = await (db as UsageInsertDb)
        .from("ai_usage_events")
        .insert({
          user_id: userId,
          provider: event.provider,
          model: event.model,
          bookmark_id: event.bookmarkId,
          status: event.status,
          error_code: event.errorCode,
          duration_ms: event.durationMs,
        });
      if (error) {
        throw error;
      }
    } catch (error) {
      console.warn("AI usage event insert failed", error);
    }
  };
}

export async function listAiUsageEvents(
  db: unknown,
  userId: string,
  days: number,
): Promise<AiUsageEvent[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { data, error } = await (db as UsageSelectDb)
    .from("ai_usage_events")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) =>
    aiUsageEventSchema.parse({
      id: row.id,
      provider: row.provider,
      model: row.model,
      bookmarkId: row.bookmark_id,
      status: row.status,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }),
  );
}
```

`categorize.ts`의 `AiUsageEventInput.bookmarkId`는 `string | null`이어야 recorder와 맞는다 — Task 1 정의가 `string`이면 `string | null`로 완화한다.

- [ ] **Step 5: 배선 — bookmarks 라우트와 ai 라우트**

`apps/api/src/routes/bookmarks.ts`의 `categorizeBookmarkForUser`에서:

```ts
import { createAiUsageRecorder } from "../services/ai-usage";
// ...
  await categorize({
    db,
    userId,
    bookmarkId,
    candidates,
    recordUsage: createAiUsageRecorder(db, userId),
  });
```

`apps/api/src/routes/ai.ts`에 조회 라우트 추가 (Bearer 전용 — 기존 `/ai` 미들웨어가 처리):

```ts
router.get("/ai/usage", async (request, response) => {
  const query = aiUsageQuerySchema.parse(request.query);
  const items = await listAiUsageEvents(
    getSupabaseDb(),
    getUserId(request),
    query.days,
  );
  response.json(aiUsageResponseSchema.parse({ days: query.days, items }));
});
```

`getSupabaseDb`는 이 파일에 아직 db 접근이 없으므로 `supabaseAdmin` import + null 가드(다른 라우트의 `getDb()` 패턴)를 추가한다. `ai-routes.test.ts`에 라우트 테스트 1건 추가: mock 서비스 옆에 supabase mock을 두고 `GET /api/ai/usage?days=7`이 `{ days: 7, items: [...] }`를 반환하는지 확인 — 라우터 팩토리가 supabase를 직접 import하므로 `vi.mock("../lib/supabase", ...)` 사용.

- [ ] **Step 6: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: AI 사용 이벤트 로깅과 조회 API 추가"
```

---

### Task 3: 설정 UI — 모델 우선순위 DND 리스트 (+ PUT /ai/model 제거)

**Files:**
- Modify: `apps/web/package.json` (`bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities` — apps/web에서 실행)
- Create: `apps/web/src/routes/_authed/-components/sortable-list.tsx`
- Modify: `apps/web/src/lib/api-client.ts`, `apps/web/src/routes/_authed/settings.tsx`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/services/ai-provider.ts`, `apps/api/src/routes/ai.ts` (selectModel 제거)
- Test: `apps/web/src/routes/_authed/-settings.test.tsx`, `apps/api/src/__tests__/ai-routes.test.ts`, `apps/api/src/__tests__/ai-provider.test.ts`

- [ ] **Step 1: 의존성 추가**

Run: `cd apps/web && bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities && cd ../..`
설치 후 `node_modules/@dnd-kit/sortable/dist` 타입 정의로 `useSortable`/`SortableContext`/`arrayMove` 시그니처를 확인하고 아래 코드를 실제 API에 맞춘다 (기억으로 쓰지 말 것).

- [ ] **Step 2: 공용 SortableList 작성**

Create `apps/web/src/routes/_authed/-components/sortable-list.tsx`:

```tsx
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export function reorderIds(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) {
    return ids;
  }
  return arrayMove(ids, from, to);
}

export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const next = reorderIds(ids, String(active.id), String(over.id));
    if (next !== ids) {
      onReorder(next);
    }
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableRow({
  id,
  handleLabel,
  className,
  children,
}: {
  id: string;
  handleLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  return (
    <div
      className={className}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        aria-label={handleLabel}
        className="icon-button cursor-grab touch-none"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

`apps/web/src/routes/_authed/-settings.test.tsx`:
- api-client mock factory에서 `selectAiModel` 제거, `reorderAiModels: vi.fn(),` 추가. import도 교체.
- aiStatus fixture에 `modelOrder: ["gemini-flash-lite-latest", "gemini-flash-latest"]` (Task 1에서 이미 추가돼 있으면 유지).
- 기존 "모델 select/모델 저장" 관련 테스트를 교체:

```tsx
  it("renders the model priority list with drag handles and moves a model down", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(reorderAiModels).mockResolvedValue(aiStatus);
    renderAiSection();

    expect(
      await screen.findByRole("button", {
        name: "Gemini Flash Lite 순서 변경",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Gemini Flash Lite 아래로 이동" }),
    );

    await waitFor(() =>
      expect(vi.mocked(reorderAiModels).mock.calls[0]?.[0]).toEqual({
        models: ["gemini-flash-latest", "gemini-flash-lite-latest"],
      }),
    );
  });
```

`reorderIds` 단위 테스트를 새 파일 `apps/web/src/routes/_authed/-components/sortable-list.test.ts`로 추가:

```ts
import { describe, expect, it } from "vitest";
import { reorderIds } from "./sortable-list";

describe("reorderIds", () => {
  it("moves the active id to the over position", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
  it("returns the same array when ids are unknown or equal", () => {
    const ids = ["a", "b"];
    expect(reorderIds(ids, "x", "a")).toBe(ids);
    expect(reorderIds(ids, "a", "a")).toBe(ids);
  });
});
```

Run: `bun run test` → RED 확인.

- [ ] **Step 4: selectModel 제거 (shared/api)**

- `packages/shared/src/index.ts`: `selectAiModelRequestSchema`와 `SelectAiModelRequest` 삭제.
- `apps/api/src/services/ai-provider.ts`: 인터페이스와 구현에서 `selectModel` 삭제 (`SelectAiModelRequest` import 제거). `getProvider`가 다른 곳에서 안 쓰이면 함께 삭제(인터페이스·`getAiProvider` export 포함) — `grep -rn "getAiProvider\b\|getProvider(" apps/api/src`로 확인.
- `apps/api/src/routes/ai.ts`: `PUT /ai/model` 라우트 삭제, 대신:

```ts
router.put("/ai/model-order", async (request, response) => {
  const body = reorderAiModelsRequestSchema.parse(request.body);
  const status = await service.reorderModels(getUserId(request), body);
  response.json(aiStatusResponseSchema.parse(status));
});
```

- `apps/api/src/__tests__/ai-routes.test.ts`: mock 서비스에서 `selectModel` → `reorderModels`로 교체, `PUT /api/ai/model` 테스트를 `PUT /api/ai/model-order` 테스트로 교체.
- `apps/api/src/__tests__/ai-provider.test.ts`: `selectModel` 테스트들을 `reorderModels` 동작 검증으로 대체(키 미설정 provider 모델 포함 시 400, 성공 시 provider/model 동기화 + 캐시 무효화 — Task 1 Step 5에서 이미 추가했다면 중복 없이 정리).

- [ ] **Step 5: api-client와 설정 UI 교체**

`apps/web/src/lib/api-client.ts`: `selectAiModel` 삭제, 추가:

```ts
export async function reorderAiModels(
  body: ReorderAiModelsRequest,
): Promise<AiStatusResponse> {
  const response = await apiFetch("/api/ai/model-order", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, (json) =>
    aiStatusResponseSchema.parse(json),
  );
}
```

`apps/web/src/routes/_authed/settings.tsx`의 `AiSection`에서 "사용 모델" 카드 내용을 교체 — `model` state/`modelMutation`/select/모델 저장 버튼 삭제, 아래로 대체:

```tsx
  const modelOrder = aiQuery.data?.modelOrder ?? [];
  const orderMutation = useMutation({
    mutationFn: reorderAiModels,
    onSuccess: (status) => {
      queryClient.setQueryData(["ai"], status);
      toast.success("모델 우선순위를 저장했어요");
    },
    onError: () => toast.error("모델 우선순위를 저장하지 못했어요"),
  });
  const moveModel = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= modelOrder.length) {
      return;
    }
    const models = [...modelOrder];
    const moved = models[index];
    const swapped = models[target];
    if (!moved || !swapped) {
      return;
    }
    models[index] = swapped;
    models[target] = moved;
    orderMutation.mutate({ models });
  };
```

리스트 렌더 (빈 상태 문구는 기존 유지):

```tsx
        {modelOrder.length === 0 ? (
          <p className="mt-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-950">
            먼저 provider API 키를 등록하세요
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-zinc-500">
              위에서부터 순서대로 시도하고, 실패하면 다음 모델로 넘어갑니다.
              드래그하거나 버튼으로 순서를 바꾸세요.
            </p>
            <SortableList
              ids={modelOrder}
              onReorder={(models) =>
                orderMutation.mutate({
                  models: models.filter(
                    (model): model is AiModelId =>
                      modelOrder.some((item) => item === model),
                  ),
                })
              }
            >
              <ol className="mt-2 space-y-2">
                {modelOrder.map((model, index) => {
                  const item = getModelConfig(model);
                  return (
                    <li key={model}>
                      <SortableRow
                        className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800"
                        handleLabel={`${item.label} 순서 변경`}
                        id={model}
                      >
                        <span className="w-5 text-center text-xs text-zinc-400">
                          {index + 1}
                        </span>
                        <span className="flex-1 text-sm">
                          {item.label}{" "}
                          <span className="text-xs text-zinc-500">
                            {aiProviderLabels[item.provider]} · {item.tier}
                          </span>
                          {index === 0 ? (
                            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[0.6875rem] text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                              우선 사용
                            </span>
                          ) : null}
                        </span>
                        <button
                          aria-label={`${item.label} 위로 이동`}
                          className="icon-button"
                          disabled={index === 0 || orderMutation.isPending}
                          onClick={() => moveModel(index, -1)}
                          type="button"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          aria-label={`${item.label} 아래로 이동`}
                          className="icon-button"
                          disabled={
                            index === modelOrder.length - 1 ||
                            orderMutation.isPending
                          }
                          onClick={() => moveModel(index, 1)}
                          type="button"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </SortableRow>
                    </li>
                  );
                })}
              </ol>
            </SortableList>
          </>
        )}
```

사용하지 않게 된 `aiModelIdSchema`/`useEffect` 모델 동기화 로직/`availableModels` 계산은 삭제. `getModelConfig`는 유지.

- [ ] **Step 6: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: 설정에서 AI 모델 우선순위를 DND로 관리"
```

---

### Task 4: 카테고리 순서 DND

**Files:**
- Modify: `apps/web/src/routes/_authed/settings.tsx` (CategorySection/CategoryRow)
- Test: `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`-settings.test.tsx`의 "category ordering" describe에 추가:

```tsx
  it("renders a drag handle for each category row", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    renderCategorySection();

    expect(
      await screen.findByRole("button", { name: "💻 개발 순서 변경" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "📰 뉴스 순서 변경" }),
    ).toBeTruthy();
  });
```

Run → RED 확인. 기존 위/아래 버튼 테스트 2건은 그대로 통과해야 한다(버튼 유지).

- [ ] **Step 2: 구현**

`CategorySection`의 목록을 `SortableList`로 감싼다:

```tsx
      <SortableList
        ids={items.map((item) => item.id)}
        onReorder={(ids) => reorderMutation.mutate(ids)}
      >
        <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((category, index) => (
            <CategoryRow ... /* 기존 props 그대로 */ />
          ))}
        </div>
      </SortableList>
```

`CategoryRow`의 루트 `<div className="grid ...">`를 `SortableRow`로 교체 — 핸들이 첫 컬럼이 되도록 grid를 `sm:grid-cols-[auto_auto_1fr_80px_auto]`로 조정:

```tsx
    <SortableRow
      className="grid gap-2 py-3 sm:grid-cols-[auto_auto_1fr_80px_auto] sm:items-center"
      handleLabel={`${category.name} 순서 변경`}
      id={category.id}
    >
      {/* 기존 위/아래 버튼 div, input, count, 삭제 버튼 그대로 */}
    </SortableRow>
```

- [ ] **Step 3: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`

```bash
git add -A
git commit -m "feat: 카테고리 순서를 드래그로 변경"
```

---

### Task 5: AI 사용량 대시보드 페이지

**Files:**
- Create: `apps/web/src/routes/_authed/ai-usage.tsx`
- Modify: `apps/web/src/lib/api-client.ts`, `apps/web/src/routes/_authed/settings.tsx` (링크)
- Test: Create `apps/web/src/routes/_authed/-ai-usage.test.tsx`

- [ ] **Step 1: api-client 추가**

```ts
export async function getAiUsage(days: number): Promise<AiUsageResponse> {
  const response = await apiFetch(`/api/ai/usage?days=${days}`);
  return parseJsonResponse(response, (json) =>
    aiUsageResponseSchema.parse(json),
  );
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `apps/web/src/routes/_authed/-ai-usage.test.tsx` (`-settings.test.tsx`의 jsdom/QueryClient 패턴):

```tsx
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({ getAiUsage: vi.fn() }));

import { getAiUsage } from "../../lib/api-client";
import { AiUsagePage, aggregateUsage } from "./ai-usage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const events = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "gemini" as const,
    model: "gemini-flash-lite-latest",
    bookmarkId: null,
    status: "success" as const,
    errorCode: null,
    durationMs: 700,
    createdAt: "2026-07-12T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    provider: "gemini" as const,
    model: "gemini-flash-lite-latest",
    bookmarkId: null,
    status: "failed" as const,
    errorCode: "429",
    durationMs: 400,
    createdAt: "2026-07-12T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    provider: "anthropic" as const,
    model: "claude-haiku-4-5",
    bookmarkId: null,
    status: "success" as const,
    errorCode: null,
    durationMs: 900,
    createdAt: "2026-07-11T10:00:00.000Z",
  },
];

describe("aggregateUsage", () => {
  it("aggregates totals per model and daily counts in local time", () => {
    const { totals, daily } = aggregateUsage(events);
    expect(totals).toEqual([
      {
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        success: 1,
        failed: 1,
      },
      {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        success: 1,
        failed: 0,
      },
    ]);
    expect(daily.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });
});

describe("AiUsagePage", () => {
  it("renders model totals and the recent event list", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiUsagePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Gemini Flash Lite")).toBeTruthy();
    expect(screen.getByText(/성공 1/)).toBeTruthy();
    expect(screen.getByText("429")).toBeTruthy();
  });
});
```

Run → RED 확인.

- [ ] **Step 3: 페이지 구현**

Create `apps/web/src/routes/_authed/ai-usage.tsx` — 구조는 `reminders.tsx`를 따른다. 핵심 요구: 기간 chip(7/30/90일, 기본 30), 모델별 합계(라벨은 `AI_MODEL_CATALOG`에서, 카탈로그에 없으면 raw id), 성공/실패 수와 최대값 대비 CSS bar, 일별 호출 수(로컬 타임존 날짜), 최근 이벤트 목록(시각·모델·상태 배지·error_code).

```tsx
import {
  AI_MODEL_CATALOG,
  type AiUsageEvent,
} from "@my-bookmark/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getAiUsage } from "../../lib/api-client";

export const Route = createFileRoute("/_authed/ai-usage")({
  component: AiUsagePage,
});

const dayOptions = [7, 30, 90] as const;

export function aggregateUsage(events: AiUsageEvent[]): {
  totals: {
    provider: AiUsageEvent["provider"];
    model: string;
    success: number;
    failed: number;
  }[];
  daily: { date: string; count: number }[];
} {
  const totalsByModel = new Map<
    string,
    {
      provider: AiUsageEvent["provider"];
      model: string;
      success: number;
      failed: number;
    }
  >();
  const countsByDate = new Map<string, number>();
  for (const event of events) {
    const total = totalsByModel.get(event.model) ?? {
      provider: event.provider,
      model: event.model,
      success: 0,
      failed: 0,
    };
    total[event.status === "success" ? "success" : "failed"] += 1;
    totalsByModel.set(event.model, total);
    const date = new Date(event.createdAt).toLocaleDateString("sv-SE");
    countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
  }
  return {
    totals: [...totalsByModel.values()].sort(
      (a, b) => b.success + b.failed - (a.success + a.failed),
    ),
    daily: [...countsByDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

export function modelLabel(model: string): string {
  return (
    AI_MODEL_CATALOG.find((item) => item.model === model)?.label ?? model
  );
}

export function AiUsagePage() {
  const [days, setDays] = useState<number>(30);
  const usageQuery = useQuery({
    queryKey: ["aiUsage", days],
    queryFn: () => getAiUsage(days),
  });
  const events = usageQuery.data?.items ?? [];
  const { totals, daily } = aggregateUsage(events);
  const maxTotal = Math.max(1, ...totals.map((t) => t.success + t.failed));
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  return (
    <main className="page-stack">
      <section className="page-header">
        <div>
          <p className="page-eyebrow">Insights</p>
          <h1 className="page-title">AI 사용량</h1>
          <p className="page-subtitle">
            언제 어떤 모델로 분류했는지 확인합니다.
          </p>
        </div>
      </section>

      <div className="flex gap-2">
        {dayOptions.map((option) => (
          <button
            className={days === option ? "chip-active" : "chip"}
            key={option}
            onClick={() => setDays(option)}
            type="button"
          >
            {option}일
          </button>
        ))}
      </div>

      <section
        aria-label="모델별 사용량"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">모델별 호출</h2>
        {totals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            아직 기록된 사용량이 없어요.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {totals.map((total) => {
              const sum = total.success + total.failed;
              return (
                <li key={total.model}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {modelLabel(total.model)}
                    </span>
                    <span className="text-xs text-zinc-500">
                      성공 {total.success} · 실패 {total.failed}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${(sum / maxTotal) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-label="일별 사용량"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">일별 호출</h2>
        <ul className="mt-3 space-y-2">
          {daily.map((day) => (
            <li className="flex items-center gap-3 text-sm" key={day.date}>
              <span className="w-24 shrink-0 text-zinc-500">{day.date}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${(day.count / maxDaily) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-zinc-500">{day.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="최근 이벤트"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">최근 이벤트</h2>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {events.slice(0, 20).map((event) => (
            <li
              className="flex items-center gap-3 py-2 text-sm"
              key={event.id}
            >
              <span className="w-40 shrink-0 text-xs text-zinc-500">
                {new Date(event.createdAt).toLocaleString()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {modelLabel(event.model)}
              </span>
              {event.status === "success" ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-200">
                  성공
                </span>
              ) : (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                  실패{event.errorCode ? ` ` : ""}
                  {event.errorCode ? (
                    <span className="ml-1">{event.errorCode}</span>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

주의: 테스트가 `429` 텍스트를 단독 노드로 찾을 수 있도록 errorCode를 별도 `<span>`으로 렌더한다(위 코드 참조). routeTree는 dev/build에서 자동 재생성된다.

- [ ] **Step 4: 설정에서 링크**

`settings.tsx`의 `AiSection` 헤더 아래(설명 문단 다음)에 추가하고 `Link`를 `@tanstack/react-router`에서 import:

```tsx
      <Link
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600"
        to="/ai-usage"
      >
        사용량 대시보드 <ChevronRight className="h-4 w-4" />
      </Link>
```

`ChevronRight`를 lucide import에 추가. `-settings.test.tsx`에 링크 테스트를 추가하되, `Link`는 라우터 컨텍스트가 필요하므로 렌더가 깨지면 이 링크 단언은 `-ai-usage.test.tsx`가 아닌 별도 라우터 mock 없이 가능한 방식으로 조정한다 — 가장 단순한 해법: `vi.mock("@tanstack/react-router", () => ({ Link: (props: { to: string; children: React.ReactNode; className?: string }) => <a href={props.to} className={props.className}>{props.children}</a> }))`를 `-settings.test.tsx` 상단에 추가하고 `screen.getByRole("link", { name: /사용량 대시보드/ })`의 href가 `/ai-usage`인지 단언.

- [ ] **Step 5: 검증 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`

```bash
git add -A
git commit -m "feat: AI 사용량 대시보드 페이지 추가"
```

---

### Task 6: 문서 동기화 + 전체 검증 + PROGRESS 갱신 (플랜 #1 Task 7 통합)

**Files:**
- Modify: `docs/02-database.md`, `docs/03-api.md`, `docs/05-ai.md`, `docs/07-ui.md`(관련 서술이 있으면), `PROGRESS.md`

- [ ] **Step 1: docs 갱신 (플랜 #1 + #2 변경 모두)**

- `docs/02-database.md`: categories에서 color 제거, bookmarks.ai_model, ai_settings.model_order, ai_usage_events 테이블 추가.
- `docs/03-api.md`: 카테고리 요청/응답에서 color 제거, `PUT /api/categories/order` 추가, PATCH sortOrder 제거, `PUT /api/ai/model` → `PUT /api/ai/model-order`, `GET /api/ai/usage` 추가, bookmark 응답에 aiModel.
- `docs/05-ai.md`: 응답 스키마에 summary(1~3문장·≤300자·nullish 파싱/required 생성), 신규 카테고리 이름 규칙(이모지 1개 + 공백 + 한국어 1~10자, zod max 16), 모델 우선순위 체인 폴백 동작(모든 throw에서 다음 후보, 전부 실패 시 failed), 사용 이벤트 기록.
- 기존 서술 위치를 수정하고 새 섹션 남발 금지.

- [ ] **Step 2: 전체 검증 루프**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: 전부 통과. 실패 시 원인 수정 후 재실행.

- [ ] **Step 3: 수동 확인 항목 정리**

마이그레이션 0005/0006/0007이 아직 push되지 않았으므로 실 DB 대상 수동 확인은 불가하다. PROGRESS에 "사용자 확인 필요"로 기록: (1) `bun x supabase db push` 후 dev 스택에서 모델 우선순위 DND·폴백(첫 모델 키를 임시로 잘못된 값으로 바꿔 429/401 유도)·편집 모달 모델 표시·대시보드 데이터·카테고리 DND 확인, (2) iOS/터치 드래그 동작.

- [ ] **Step 4: PROGRESS.md 갱신 + Commit**

결정 로그에 플랜 #1·#2의 "결정 사항" 표 항목들을 날짜와 함께 추가. 현재 상태 갱신.

```bash
git add -A
git commit -m "docs: 카테고리 개편·AI 폴백 체인·사용량 대시보드 반영"
```

---

## 주의사항 (구현 세션 필독)

- **CLAUDE.md 작업 프로토콜 준수.** `@dnd-kit` API는 설치 후 `node_modules` 타입 정의로 확인하고 사용한다 — 계획서 코드가 실제 시그니처와 다르면 실제 API에 맞춘다.
- **마이그레이션 push 금지.** 0006/0007은 파일 생성까지만. 원격 반영은 사용자가 0005와 함께 일괄 실행.
- `bookmarkSchema`·`aiStatusResponseSchema` 필드 추가는 fixture 컴파일 에러를 유발한다 — typecheck가 가리키는 모든 fixture를 성실히 갱신하고, 테스트 의미가 바뀌지 않는지 확인.
- `any`/`@ts-ignore` 금지, 테스트 skip 금지, 검증 실패 상태로 커밋 금지.
