# 카테고리 개편(색상 제거·이모지 이름·순서 변경) + AI 재분류·요약 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카테고리에서 색상 기능을 제거하고, AI가 신규 카테고리를 "이모지 + 텍스트" 단일 문자열 이름으로 만들며, 카테고리 순서 변경·AI 재분류 상시 노출·1~3문장 AI 요약을 추가한다.

**Architecture:** 카테고리는 별도 icon/color 컬럼 없이 `name` 문자열 하나로 표현한다(예: `"💻 개발"`). AI 응답 스키마에 `summary`(1~3문장)를 추가해 `bookmarks.description`에 저장하고, 순서 변경은 `PUT /api/categories/order`(id 배열 → `sort_order` = index) 단일 엔드포인트로 처리한다. AI 재분류는 기존 `POST /api/bookmarks/:id/categorize`를 그대로 쓰고 UI 노출 조건만 바꾼다.

**Tech Stack:** Bun workspaces, TanStack Start(React 19), Express 5, Supabase(Postgres), zod, Vitest, Biome.

---

## 사용자 요구사항 (스펙)

1. **카테고리 색상 기능 제거** — DB 컬럼, zod 스키마, API, 설정 UI에서 color를 완전히 제거한다.
2. **카테고리는 "이모지 아이콘 + 텍스트" 단일 문자열** — 별도 컬럼 없음. AI가 신규 카테고리를 만들 때 이름 앞에 주제 이모지를 붙인다(예: `"💻 개발"`). 카테고리 이름은 단순 텍스트이므로 칩/셀렉트 등 기존 UI는 그대로 렌더된다.
3. **카테고리 순서 변경** — 설정 화면에서 위/아래 버튼으로 순서를 바꾸고, 홈 칩·셀렉트 정렬(`sort_order asc`)에 반영된다.
4. **AI 재분류 상시 노출** — 현재 `ai_status === "failed"`일 때만 보이는 "AI 재분류" 메뉴를 pending이 아닌 모든 북마크에 노출한다. 재분류는 제목·요약·태그·카테고리를 덮어쓰므로 실행 전 `window.confirm`으로 확인한다.
5. **AI 요약 1~3문장** — AI가 `summary`(한국어 1~3문장, 300자 이내)를 생성해 `bookmarks.description`에 저장한다. 카드에는 최대 3줄(`line-clamp-3`)로 표시한다. 기존 `summaryTitle`(40자 제목)은 유지.

## 결정 사항 (구현 중 재논의 금지 — PROGRESS 결정 로그에 기록할 것)

| 결정 | 이유 |
|---|---|
| `categories.color` 컬럼을 drop한다 (데이터 소실 허용) | 사용자가 색상 기능 제거를 명시 요청. 1인 서비스라 마이그레이션 부담 없음 |
| 이모지는 `name` 문자열에 포함 (별도 컬럼 없음) | 사용자 확정: "카테고리는 단순 텍스트이고 AI가 아이콘을 붙여서 만들도록" |
| AI 신규 카테고리 이름 zod max를 10 → 16으로 상향 | 이모지(UTF-16 최대 ~7 code unit) + 공백 + 한국어 1~10자를 수용. DB check는 50이라 여유 있음 |
| 카테고리 중복 판정 시 선두 이모지/기호를 제거하고 비교 | AI가 `"💻 개발"`을 제안했는데 기존에 `"개발"`이 있으면 재사용해야 함 (역방향 포함) |
| AI `summary`는 `bookmarks.description`에 저장 (신규 컬럼 없음) | 검색 함수(`search_bookmarks`)가 이미 description을 검색하고, 카드·편집 폼도 이미 description을 사용. AI가 title을 덮어쓰는 기존 패턴과 일관 |
| zod에서 `summary`는 optional, provider JSON 스키마에서는 required | Gemini가 confidence를 생략했던 전례(결정 로그 2026-07-12 이전 항목)에 대한 방어. 누락 시 분류 전체를 실패시키지 않고 description만 건너뜀 |
| 순서 변경은 `PUT /api/categories/order` (전체 id 배열), `PATCH /categories/:id`의 `sortOrder`는 제거 | 순서 변경 경로를 하나로 유지. 인접 swap을 PATCH 2번으로 하면 비원자적 |
| 순서 UI는 위/아래 버튼 (drag-drop 아님) | 의존성 추가 없이 접근성(키보드/스크린리더) 확보. Apple 스타일 절제 원칙 |
| 재분류 확인은 `window.confirm` | 카테고리 삭제·API 키 회수 등 기존 confirm 패턴과 일관 |

## File Structure

| 파일 | 변경 |
|---|---|
| `supabase/migrations/0005_drop_category_color.sql` | **생성** — color 컬럼 drop |
| `packages/shared/src/index.ts` | color 스키마 제거, `reorderCategoriesRequestSchema` 추가, update 스키마에서 sortOrder 제거 |
| `packages/ai/src/types.ts` | `AnalyzeResult.summary?` 추가 |
| `packages/ai/src/schema.ts` | 신규 이름 max 16, summary 필드, 프롬프트 규칙(이모지·요약) |
| `packages/ai/src/providers.ts` | Gemini responseSchema에 summary 추가 |
| `apps/api/src/routes/categories.ts` | color 제거, `PUT /categories/order` 추가, PATCH sortOrder 제거 |
| `apps/api/src/lib/db-mappers.ts` | color 제거 |
| `apps/api/src/services/categorize.ts` | createCategory color 제거, 이름 정규화 비교, markDone에 description 저장 |
| `apps/web/src/lib/api-client.ts` | `reorderCategories` 추가 |
| `apps/web/src/routes/_authed/settings.tsx` | color UI 제거, 순서 버튼, `CategorySection` export |
| `apps/web/src/routes/_authed/index.tsx` | 요약 3줄 표시, AI 재분류 상시 노출 + confirm |
| `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` | createCategory color 제거, placeholder 힌트 |
| 테스트 | `categorize.test.ts`, `provider.test.ts`, `-index.test.tsx`, `-settings.test.tsx` 수정, `categories-reorder.test.ts` 생성 |

모든 커밋 전 공통 검증: `bun run typecheck && bun run lint && bun run test` (마지막 Task에서 `bun run build` 포함 전체 루프).

---

### Task 1: 카테고리 색상 기능 제거 (DB + shared + api + web)

색상은 스키마 원본(`packages/shared`)에서 제거하는 순간 전 워크스페이스 타입이 깨지므로, 이 Task는 한 커밋으로 원자적으로 처리한다.

**Files:**
- Create: `supabase/migrations/0005_drop_category_color.sql`
- Modify: `packages/shared/src/index.ts:28-50, 147-160`
- Modify: `apps/api/src/routes/categories.ts:13-17, 52-70, 72-103`
- Modify: `apps/api/src/lib/db-mappers.ts:30-38, 70-79`
- Modify: `apps/api/src/services/categorize.ts:210-230`
- Modify: `apps/web/src/routes/_authed/settings.tsx` (CategorySection, CategoryRow)
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx:145-150`
- Test: `apps/web/src/routes/_authed/-index.test.tsx:76-84`

- [ ] **Step 1: shared에서 color 제거**

`packages/shared/src/index.ts`에서:

(a) `categoryColorSchema` 전체 삭제 (line 28-37):

```ts
// 삭제:
export const categoryColorSchema = z.enum([
  "red", "orange", "amber", "green", "teal", "blue", "violet", "pink",
]);
```

(b) `categorySchema`에서 `color: categoryColorSchema.nullable(),` 줄 삭제:

```ts
export const categorySchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1).max(50),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
});
```

(c) `createCategoryRequestSchema`에서 color 삭제:

```ts
export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
```

(d) `updateCategoryRequestSchema`에서 color 삭제 (sortOrder는 Task 4에서 제거하므로 여기서는 유지):

```ts
export const updateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });
```

- [ ] **Step 2: api에서 color 제거**

`apps/api/src/routes/categories.ts`:

```ts
interface CategoryUpdate {
  name?: string;
  sort_order?: number;
}
```

POST 핸들러의 insert에서 `color: body.color ?? null,` 줄 삭제:

```ts
    .insert({
      user_id: userId,
      name: body.name,
    })
```

PATCH 핸들러에서 다음 블록 삭제:

```ts
  // 삭제:
  if (body.color !== undefined) {
    updates.color = body.color;
  }
```

`apps/api/src/lib/db-mappers.ts`: `CategoryDbRow`에서 `color: Category["color"];` 삭제, `mapCategory`에서 `color: row.color,` 삭제. 파일 상단 import에서 쓰이지 않게 되는 것은 없음(Category 타입은 계속 사용).

`apps/api/src/services/categorize.ts`의 `createCategory`(line ~216):

```ts
    .insert({ user_id: userId, name })
```

- [ ] **Step 3: web에서 color 제거**

`apps/web/src/routes/_authed/settings.tsx`:
- import에서 `categoryColorSchema` 제거.
- `const colors = categoryColorSchema.options;` (line 41) 삭제.
- `CategorySection`: `const [color, setColor] = useState(...)` 삭제, `createMutation.mutate({ name, color })` → `createMutation.mutate({ name })`, `updateCategory(id, {...})` 호출에서 `color: next.color,` 제거, 폼의 `<select>` 블록(line 247-259) 삭제, 폼 grid를 `sm:grid-cols-[1fr_160px_auto]` → `sm:grid-cols-[1fr_auto]`로 변경.
- `CategoryRow`: `const [color, setColor] = useState(...)` 와 color `<select>` 블록(line 313-324) 삭제, grid를 `sm:grid-cols-[1fr_140px_80px_auto]` → `sm:grid-cols-[1fr_80px_auto]`로 변경.

`apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` (line 145-150):

```ts
                onClick={() =>
                  createCategoryMutation.mutate({ name: newCategoryName })
                }
```

- [ ] **Step 4: 테스트 fixture에서 color 제거**

`apps/web/src/routes/_authed/-index.test.tsx`의 category fixture(line 76-84)에서 `color: "blue",` 줄 삭제.

- [ ] **Step 5: 잔여 참조 확인 + 검증**

Run: `grep -rn "categoryColorSchema\|category.color\|color:" packages/shared/src apps/api/src apps/web/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -vi "theme-color\|prefers-color"`
Expected: 매치 없음 (있으면 해당 참조도 제거).

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

- [ ] **Step 6: 마이그레이션 생성 + 원격 적용**

Create `supabase/migrations/0005_drop_category_color.sql`:

```sql
alter table public.categories drop column color;
```

Run: `bun x supabase db push --dry-run`
Expected: `0005_drop_category_color.sql` 1개만 적용 대상으로 표시.

Run: `bun x supabase db push`
Expected: 적용 완료. (주의: 코드가 color를 더 이상 참조하지 않는 이 시점에 push해야 한다. push보다 먼저 dev 서버가 구버전 코드로 돌고 있으면 재시작.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 카테고리 색상 기능 제거"
```

---

### Task 2: AI 신규 카테고리를 "이모지 + 텍스트" 이름으로 생성

**Files:**
- Modify: `packages/ai/src/schema.ts:4-16, 75-87`
- Modify: `apps/api/src/services/categorize.ts:200-208`
- Modify: `apps/web/src/routes/_authed/settings.tsx` (placeholder), `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx:137` (placeholder)
- Test: `apps/api/src/__tests__/categorize.test.ts`, `packages/ai/src/__tests__/provider.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 — 이모지 접두 이름의 중복 재사용**

`apps/api/src/__tests__/categorize.test.ts`의 `describe("applyCategorizeResult")` 안에 추가:

```ts
  it("reuses an existing plain-name category when AI proposes an emoji-prefixed name", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: "💻 개발", confidence: 0.8 }),
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-dev");
  });

  it("reuses an existing emoji-prefixed category when AI proposes a plain name", async () => {
    const db = new FakeDb();
    db.categories = [{ id: "cat-news", name: "📰 뉴스" }];
    await applyCategorizeResult(
      db,
      "user",
      "bookmark",
      db.categories,
      analysis({ type: "new", name: "뉴스", confidence: 0.8 }),
    );

    expect(db.categories).toHaveLength(1);
    expect(db.bookmark.category_id).toBe("cat-news");
  });
```

`packages/ai/src/__tests__/provider.test.ts`의 `parses a complete analysis and rejects malformed analysis` 테스트에 추가 (기존 expect들 뒤):

```ts
    expect(
      parseAnalyzeResponse({
        ...expected,
        category: { type: "new", name: "📰 국제 뉴스 요약", confidence: 0.7 },
      }),
    ).toEqual({
      ...expected,
      category: { type: "new", name: "📰 국제 뉴스 요약", confidence: 0.7 },
    });
```

(참고: `"📰 국제 뉴스 요약"`은 UTF-16 기준 11 code unit이라 기존 `max(10)`에서 실패한다 — RED 확인용으로 적합.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test`
Expected: 위 3개 테스트 FAIL (dedup 2건은 카테고리가 2개가 됨, 스키마 1건은 `parseAnalyzeResponse`가 null 반환).

- [ ] **Step 3: 스키마·프롬프트 수정**

`packages/ai/src/schema.ts`의 `categorizeResponseSchema` new 분기에서 `max(10)` → `max(16)`:

```ts
  z.object({
    type: z.literal("new"),
    name: z.string().trim().min(1).max(16),
    confidence: z.number().min(0).max(1).default(0),
  }),
```

`systemPrompt()`의 규칙 3을 교체:

```ts
    "3. 새 카테고리 이름은 '이모지 1개 + 공백 + 한국어 이름(1~10자)' 형식의 한 문자열로 만든다. 예: '💻 개발', '📰 뉴스', '🎨 디자인'. 이모지는 주제를 대표하는 것 1개만 앞에 붙이고, 이름은 일반적·재사용 가능한 수준으로 한다.",
```

- [ ] **Step 4: 이름 정규화 비교 구현**

`apps/api/src/services/categorize.ts`의 `findCategoryByNormalizedName`(line 200-208)을 교체:

```ts
// AI는 "💻 개발"처럼 이모지 접두 이름을 제안하므로, 중복 판정은
// 선두의 비문자(이모지·기호) 부분을 제거한 뒤 비교한다.
function normalizeCategoryName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
}

function findCategoryByNormalizedName(
  categories: CategoryRow[],
  name: string,
): CategoryRow | undefined {
  const normalizedName = normalizeCategoryName(name);
  return categories.find(
    (item) => normalizeCategoryName(item.name) === normalizedName,
  );
}
```

- [ ] **Step 5: 수동 생성 입력에 형식 힌트 추가**

`apps/web/src/routes/_authed/settings.tsx` CategorySection의 이름 input placeholder: `"새 카테고리"` → `"새 카테고리 (예: 💻 개발)"`.
`apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` line 137 placeholder: `"새 카테고리 이름"` → `"새 카테고리 (예: 💻 개발)"`.

- [ ] **Step 6: 테스트 통과 확인 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: AI 신규 카테고리를 이모지+텍스트 이름으로 생성"
```

---

### Task 3: AI 요약(summary) 1~3문장 생성 → description 저장 + 카드 3줄 표시

**Files:**
- Modify: `packages/ai/src/types.ts:14-18`
- Modify: `packages/ai/src/schema.ts:27-44, 58-73, 75-87`
- Modify: `packages/ai/src/providers.ts:74-99` (Gemini responseSchema)
- Modify: `apps/api/src/services/categorize.ts:163-183` (markDone)
- Modify: `apps/web/src/routes/_authed/index.tsx:405-409`
- Test: `apps/api/src/__tests__/categorize.test.ts`, `packages/ai/src/__tests__/provider.test.ts`, `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/api/src/__tests__/categorize.test.ts`:

(a) `analysis` 헬퍼(line 74-78)에 summary 추가:

```ts
const analysis = (category: AnalyzeResult["category"]): AnalyzeResult => ({
  category,
  summaryTitle: "웹 접근성 실전 안내",
  summary: "웹 접근성의 핵심 원칙을 실무 예제로 설명한다. 폼 라벨과 키보드 내비게이션 개선 방법을 다룬다.",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
});
```

(b) 첫 테스트 `applies category, summary title, and tags in one pending-guarded update`의 기대 update에 description 추가:

```ts
    expect(db.bookmarkUpdates).toEqual([
      {
        category_id: null,
        title: "웹 접근성 실전 안내",
        description:
          "웹 접근성의 핵심 원칙을 실무 예제로 설명한다. 폼 라벨과 키보드 내비게이션 개선 방법을 다룬다.",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
        ai_status: "done",
      },
    ]);
```

(c) summary 누락 방어 테스트 추가 (`describe("applyCategorizeResult")` 안):

```ts
  it("keeps the existing description when the AI omits summary", async () => {
    const db = new FakeDb();
    await applyCategorizeResult(db, "user", "bookmark", db.categories, {
      category: { type: "none" },
      summaryTitle: "웹 접근성 실전 안내",
      tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
    });

    expect(db.bookmarkUpdates).toEqual([
      {
        category_id: null,
        title: "웹 접근성 실전 안내",
        tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
        ai_status: "done",
      },
    ]);
  });
```

`packages/ai/src/__tests__/provider.test.ts`의 `expected` fixture(line 54-62)에 summary 추가:

```ts
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
```

그리고 `parses a complete analysis...` 테스트에 300자 초과 거부 확인 추가:

```ts
    expect(
      parseAnalyzeResponse({ ...expected, summary: "가".repeat(301) }),
    ).toBeNull();
```

`apps/web/src/routes/_authed/-index.test.tsx`에 카드 요약 3줄 테스트 추가 (`describe("HomePage")` 안):

```tsx
  it("renders the AI summary clamped to three lines", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [
        {
          ...bookmark,
          description: "요약 첫 문장. 요약 둘째 문장. 요약 셋째 문장.",
        },
      ],
      nextCursor: null,
    });

    renderHome();

    const summary = await screen.findByText(
      "요약 첫 문장. 요약 둘째 문장. 요약 셋째 문장.",
    );
    expect(summary.className).toContain("line-clamp-3");
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test`
Expected: categorize/description 기대 FAIL, provider fixture는 스키마에 summary가 없어 그대로 통과하거나 parse 결과 불일치로 FAIL, line-clamp-3 FAIL. (shared 타입에 summary가 없어 typecheck도 깨진 상태 — 다음 스텝에서 해소.)

- [ ] **Step 3: AI 패키지에 summary 추가**

`packages/ai/src/types.ts`:

```ts
export interface AnalyzeResult {
  category: CategorizeResult;
  summaryTitle: string;
  summary?: string;
  tags: string[];
}
```

`packages/ai/src/schema.ts`:

(a) `analyzeResponseSchema`에 summary 추가 (provider가 생략해도 분류 전체를 실패시키지 않도록 optional — Gemini confidence 생략 전례 대응):

```ts
export const analyzeResponseSchema = z.object({
  category: categorizeResponseSchema,
  summaryTitle: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(1).max(300).optional(),
  tags: z
    .array(z.string().trim().min(1).max(20))
    .min(3)
    .max(5)
    .refine((tags) => new Set(tags).size === tags.length),
});
```

(b) `jsonSchema`(Anthropic tool 스키마)에 summary 추가 — provider 스키마에서는 required로 강제:

```ts
export const jsonSchema = {
  type: "object" as const,
  properties: {
    category: categoryJsonSchema,
    summaryTitle: { type: "string" as const, minLength: 1, maxLength: 40 },
    summary: { type: "string" as const, minLength: 1, maxLength: 300 },
    tags: {
      type: "array" as const,
      items: { type: "string" as const, minLength: 1, maxLength: 20 },
      minItems: 3,
      maxItems: 5,
      uniqueItems: true,
    },
  },
  required: ["category", "summaryTitle", "summary", "tags"],
  additionalProperties: false,
};
```

(c) `systemPrompt()`에 규칙 추가 (기존 7번 뒤):

```ts
    "8. summary는 원문의 핵심을 한국어 1~3문장으로 요약한다. 불필요한 수식 없이 정보만 담고, 전체 300자 이내로 한다.",
```

`packages/ai/src/providers.ts` Gemini `responseSchema`의 properties에 `summary: { type: Type.STRING },` 추가하고 required를 `["category", "summaryTitle", "summary", "tags"]`로 변경.

주의: OpenAI는 `zodTextFormat(analyzeResponseSchema, ...)`를 그대로 쓰므로 코드 변경 없음. `openai-schema.test.ts`가 `.optional()` 필드로 인해 throw하면(OpenAI strict 모드는 optional 미지원 가능), zod 스키마를 `.optional()` 대신 `.nullable().optional()` 이 아니라 **required로 바꾸지 말고** OpenAI 전용 스키마 분리를 검토하지도 말 것 — 이 경우에만 `summary: z.string().trim().min(1).max(300).nullish()`로 바꾸고 categorize의 falsy 가드(Step 4)가 null을 걸러내게 한다. 먼저 테스트를 돌려 실제로 throw하는지 확인하고, throw하지 않으면 optional 유지.

- [ ] **Step 4: markDone에 description 저장**

`apps/api/src/services/categorize.ts`의 `markDone`(line 163-183) update 객체를 교체:

```ts
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update({
      category_id: categoryId,
      title: result.summaryTitle,
      ...(result.summary ? { description: result.summary } : {}),
      tags: result.tags,
      ai_status: "done",
    })
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .eq("ai_status", "pending");
```

- [ ] **Step 5: 카드 요약 3줄 표시**

`apps/web/src/routes/_authed/index.tsx` line 406: `line-clamp-2` → `line-clamp-3`:

```tsx
          {bookmark.description ? (
            <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">
              {bookmark.description}
            </p>
          ) : null}
```

- [ ] **Step 6: 테스트 통과 확인 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과 (openai-schema.test.ts 포함).

```bash
git add -A
git commit -m "feat: AI가 1~3문장 요약을 생성해 설명으로 저장"
```

---

### Task 4: 카테고리 순서 변경 API (`PUT /api/categories/order`)

**Files:**
- Modify: `packages/shared/src/index.ts` (reorder 스키마 추가, update 스키마 sortOrder 제거)
- Modify: `apps/api/src/routes/categories.ts`
- Test: Create `apps/api/src/__tests__/categories-reorder.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/api/src/__tests__/categories-reorder.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";
const catA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const catB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const createdAt = "2026-07-12T12:00:00.000Z";

const fake = vi.hoisted(() => ({
  rows: [] as { id: string; name: string; sort_order: number }[],
  sortOrderUpdates: [] as { id: string; sort_order: number }[],
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table !== "categories") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: (columns: string) => ({
          eq: () => {
            const idRows = { data: fake.rows.map((r) => ({ id: r.id })), error: null };
            if (columns === "id") {
              return Promise.resolve(idRows);
            }
            const fullRows = [...fake.rows]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((r) => ({
                id: r.id,
                user_id: userId,
                name: r.name,
                sort_order: r.sort_order,
                created_at: createdAt,
              }));
            return {
              order: () => ({
                order: () => Promise.resolve({ data: fullRows, error: null }),
              }),
            };
          },
        }),
        update: (values: { sort_order: number }) => ({
          eq: () => ({
            eq: (_field: string, id: string) => {
              fake.sortOrderUpdates.push({ id, sort_order: values.sort_order });
              const row = fake.rows.find((r) => r.id === id);
              if (row) {
                row.sort_order = values.sort_order;
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      };
    }),
  },
}));

vi.mock("../middleware/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...original,
    requireAuth:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.userId = userId;
        next();
      },
  };
});

import { errorMiddleware } from "../middleware/error";
import { categoriesRouter } from "../routes/categories";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", categoriesRouter);
  app.use(errorMiddleware);
  return app;
}

beforeEach(() => {
  fake.rows = [
    { id: catA, name: "💻 개발", sort_order: 0 },
    { id: catB, name: "📰 뉴스", sort_order: 1 },
  ];
  fake.sortOrderUpdates = [];
});

describe("PUT /api/categories/order", () => {
  it("assigns sort_order by array index and returns the reordered list", async () => {
    const response = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catB, catA] });

    expect(response.status).toBe(200);
    expect(fake.sortOrderUpdates).toEqual([
      { id: catB, sort_order: 0 },
      { id: catA, sort_order: 1 },
    ]);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      catB,
      catA,
    ]);
  });

  it("rejects a list that does not include every category exactly once", async () => {
    const missing = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catA] });
    expect(missing.status).toBe(400);

    const duplicated = await request(createTestApp())
      .put("/api/categories/order")
      .send({ ids: [catA, catA] });
    expect(duplicated.status).toBe(400);

    const unknown = await request(createTestApp())
      .put("/api/categories/order")
      .send({
        ids: [catA, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      });
    expect(unknown.status).toBe(400);

    expect(fake.sortOrderUpdates).toEqual([]);
  });

  it("rejects sortOrder through PATCH now that reorder is a dedicated endpoint", async () => {
    const response = await request(createTestApp())
      .patch(`/api/categories/${catA}`)
      .send({ sortOrder: 3 });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test --filter @my-bookmark/api` (또는 `bun run test`)
Expected: FAIL — `PUT /categories/order` 미구현(404), PATCH sortOrder는 아직 허용(200 경로).

- [ ] **Step 3: shared에 reorder 스키마 추가 + update에서 sortOrder 제거**

`packages/shared/src/index.ts`:

```ts
export const updateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const reorderCategoriesRequestSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(200),
});
```

타입 export 목록에 추가:

```ts
export type ReorderCategoriesRequest = z.infer<
  typeof reorderCategoriesRequestSchema
>;
```

주의: `updateCategoryRequestSchema`는 `.strict()`가 아니므로 `{ sortOrder: 3 }`만 보내면 unknown key가 strip되어 빈 객체 → `.refine` 실패로 400이 된다. 별도 처리 불필요.

- [ ] **Step 4: 라우트 구현**

`apps/api/src/routes/categories.ts`:

(a) import에 `reorderCategoriesRequestSchema` 추가.
(b) `CategoryUpdate`에서 `sort_order?: number;` 제거, PATCH 핸들러에서 `if (body.sortOrder !== undefined) { ... }` 블록 제거.
(c) GET 핸들러 아래(PATCH보다 앞이든 뒤든 무관 — 메서드가 PUT이라 `:id` 라우트와 충돌 없음)에 추가:

```ts
categoriesRouter.put("/categories/order", async (request, response) => {
  const userId = getUserId(request);
  const body = reorderCategoriesRequestSchema.parse(request.body);
  const db = getDb();

  const { data: existing, error: loadError } = await db
    .from("categories")
    .select("id")
    .eq("user_id", userId);
  if (loadError) {
    throw loadError;
  }
  const existingIds = new Set((existing ?? []).map((row) => row.id));
  const uniqueRequested = new Set(body.ids);
  const isExactPermutation =
    uniqueRequested.size === body.ids.length &&
    existingIds.size === body.ids.length &&
    body.ids.every((id) => existingIds.has(id));
  if (!isExactPermutation) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "ids must include every category exactly once",
    );
  }

  for (const [index, id] of body.ids.entries()) {
    const { error } = await db
      .from("categories")
      .update({ sort_order: index })
      .eq("user_id", userId)
      .eq("id", id);
    if (error) {
      throw error;
    }
  }

  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    throw error;
  }
  response.json({ items: (data ?? []).map(mapCategory) });
});
```

- [ ] **Step 5: 테스트 통과 확인 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: 카테고리 순서 변경 API 추가"
```

---

### Task 5: 카테고리 순서 변경 UI (설정 화면 위/아래 버튼)

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/_authed/settings.tsx` (CategorySection export + 버튼)
- Test: `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/routes/_authed/-settings.test.tsx`:

(a) `vi.mock("../../lib/api-client", ...)` factory에 `reorderCategories: vi.fn(),` 추가.
(b) import에 `listCategories`, `reorderCategories`와 `CategorySection` 추가 (`from "./settings"`).
(c) 테스트 추가:

```tsx
describe("category ordering", () => {
  const categories = {
    items: [
      {
        id: "00000000-0000-4000-8000-00000000000a",
        userId: "00000000-0000-4000-8000-000000000002",
        name: "💻 개발",
        sortOrder: 0,
        createdAt: "2026-07-12T00:00:00.000Z",
        bookmarkCount: 2,
      },
      {
        id: "00000000-0000-4000-8000-00000000000b",
        userId: "00000000-0000-4000-8000-000000000002",
        name: "📰 뉴스",
        sortOrder: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
        bookmarkCount: 1,
      },
    ],
  };

  function renderCategorySection() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <CategorySection />
      </QueryClientProvider>,
    );
  }

  it("moves a category up by sending the full reordered id list", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    vi.mocked(reorderCategories).mockResolvedValue(categories);
    renderCategorySection();

    fireEvent.click(
      await screen.findByRole("button", { name: "📰 뉴스 위로 이동" }),
    );

    await waitFor(() =>
      expect(reorderCategories).toHaveBeenCalledWith([
        "00000000-0000-4000-8000-00000000000b",
        "00000000-0000-4000-8000-00000000000a",
      ]),
    );
  });

  it("disables boundary move buttons", async () => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    renderCategorySection();

    const firstUp = await screen.findByRole<HTMLButtonElement>("button", {
      name: "💻 개발 위로 이동",
    });
    const lastDown = screen.getByRole<HTMLButtonElement>("button", {
      name: "📰 뉴스 아래로 이동",
    });
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test`
Expected: FAIL — `CategorySection` 미export, `reorderCategories` 미존재, 버튼 없음.

- [ ] **Step 3: api-client에 reorderCategories 추가**

`apps/web/src/lib/api-client.ts` (updateCategory 아래):

```ts
export async function reorderCategories(
  ids: string[],
): Promise<CategoriesResponse> {
  const response = await apiFetch("/api/categories/order", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  return parseJsonResponse(response, (json) =>
    categoriesResponseSchema.parse(json),
  );
}
```

- [ ] **Step 4: 설정 화면에 순서 버튼 구현**

`apps/web/src/routes/_authed/settings.tsx`:

(a) lucide import에 `ChevronDown, ChevronUp` 추가, api-client import에 `reorderCategories` 추가.
(b) `function CategorySection()` → `export function CategorySection()`.
(c) CategorySection 안에 mutation과 이동 핸들러 추가 (deleteMutation 아래):

```tsx
  const reorderMutation = useMutation({
    mutationFn: reorderCategories,
    onSuccess: () => invalidate(),
    onError: () => toast.error("순서를 변경하지 못했어요"),
  });
  const items = categoriesQuery.data?.items ?? [];
  const moveCategory = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    const ids = items.map((item) => item.id);
    const moved = ids[index];
    const swapped = ids[target];
    if (!moved || !swapped) {
      return;
    }
    ids[index] = swapped;
    ids[target] = moved;
    reorderMutation.mutate(ids);
  };
```

(d) 목록 렌더를 index 기반으로 바꾸고 CategoryRow에 이동 props 전달:

```tsx
      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((category, index) => (
          <CategoryRow
            category={category}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            key={category.id}
            moving={reorderMutation.isPending}
            onDelete={() => {
              const count = category.bookmarkCount ?? 0;
              if (
                window.confirm(
                  `북마크 ${count}개가 미분류가 됩니다. 삭제할까요?`,
                )
              ) {
                deleteMutation.mutate(category.id);
              }
            }}
            onMove={(direction) => moveCategory(index, direction)}
            onUpdate={(next) =>
              updateMutation.mutate({ id: category.id, next })
            }
          />
        ))}
      </div>
```

(e) `updateMutation`의 `mutationFn`은 name만 보내도록 단순화:

```tsx
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      next,
    }: {
      id: string;
      next: Partial<CategoryWithCount>;
    }) => updateCategory(id, { name: next.name }),
```

(f) `CategoryRow` 시그니처와 마크업 (Task 1에서 color가 이미 제거된 상태 기준):

```tsx
function CategoryRow({
  category,
  isFirst,
  isLast,
  moving,
  onMove,
  onUpdate,
  onDelete,
}: {
  category: CategoryWithCount;
  isFirst: boolean;
  isLast: boolean;
  moving: boolean;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (next: Partial<CategoryWithCount>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[auto_1fr_80px_auto] sm:items-center">
      <div className="flex gap-1">
        <button
          aria-label={`${category.name} 위로 이동`}
          className="icon-button"
          disabled={isFirst || moving}
          onClick={() => onMove(-1)}
          type="button"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          aria-label={`${category.name} 아래로 이동`}
          className="icon-button"
          disabled={isLast || moving}
          onClick={() => onMove(1)}
          type="button"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <input
        className="input"
        onBlur={() => name !== category.name && onUpdate({ name })}
        onChange={(e) => setName(e.target.value)}
        value={name}
      />
      <span className="text-sm text-zinc-500">
        {category.bookmarkCount ?? 0}개
      </span>
      <button
        aria-label="카테고리 삭제"
        className="icon-button text-red-600"
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 테스트 통과 확인 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: 설정에서 카테고리 순서 변경"
```

---

### Task 6: AI 재분류 메뉴 상시 노출 + 실행 전 확인

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx:471-479`
- Test: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/routes/_authed/-index.test.tsx`에 추가 (`recategorizeBookmark`를 api-client mock에서 import — factory에는 이미 있음, import 구문에만 추가):

```tsx
  it("recategorizes a done bookmark after user confirmation", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });
    vi.mocked(recategorizeBookmark).mockResolvedValue(bookmark);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);

    renderHome();

    fireEvent.click(
      await screen.findByRole("button", { name: "북마크 메뉴" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /AI 재분류/ }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(recategorizeBookmark).toHaveBeenCalledWith(bookmark.id),
    );

    vi.unstubAllGlobals();
  });

  it("does not recategorize when the user cancels the confirmation", async () => {
    // 이 테스트 파일은 afterEach에서 clearAllMocks를 하지 않으므로
    // 앞 테스트의 호출 기록을 지워야 not.toHaveBeenCalled가 유효하다.
    vi.mocked(recategorizeBookmark).mockClear();
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });
    vi.stubGlobal("confirm", vi.fn(() => false));

    renderHome();

    fireEvent.click(
      await screen.findByRole("button", { name: "북마크 메뉴" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /AI 재분류/ }));

    expect(recategorizeBookmark).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
```

(fixture `bookmark`는 `aiStatus: "done"`이므로 현재 구현에서는 메뉴에 "AI 재분류"가 아예 없어 FAIL한다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `bun run test`
Expected: 두 테스트 FAIL — "AI 재분류" 버튼을 찾지 못함.

- [ ] **Step 3: 구현**

`apps/web/src/routes/_authed/index.tsx` line 471-479의 조건부 메뉴를 교체:

```tsx
              {bookmark.aiStatus !== "pending" ? (
                <button
                  className="menu-item"
                  onClick={() =>
                    runMenuAction(() => {
                      if (
                        window.confirm(
                          "AI가 제목, 요약, 태그, 카테고리를 다시 생성합니다. 계속할까요?",
                        )
                      ) {
                        onRecategorize();
                      }
                    })
                  }
                  type="button"
                >
                  <Sparkles className="h-4 w-4" /> AI 재분류
                </button>
              ) : null}
```

lucide import에 `Sparkles` 추가 (기존 메뉴 항목들이 아이콘을 갖는 것과 일관되게).

- [ ] **Step 4: 테스트 통과 확인 + Commit**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: 전부 통과.

```bash
git add -A
git commit -m "feat: AI 재분류를 모든 북마크에서 실행 가능하게"
```

---

### Task 7: 문서 동기화 + 전체 검증 + PROGRESS 갱신

**Files:**
- Modify: `docs/02-database.md` (categories 테이블에서 color 제거)
- Modify: `docs/03-api.md` (카테고리 요청/응답에서 color 제거, `PUT /api/categories/order` 추가, PATCH sortOrder 제거)
- Modify: `docs/05-ai.md` (응답 스키마에 summary 추가, 신규 카테고리 이름 규칙을 이모지+텍스트로 갱신)
- Modify: `PROGRESS.md`

- [ ] **Step 1: docs를 구현과 일치하도록 갱신**

docs는 스펙의 원본이므로 이번 변경을 반영한다. 각 문서에서 categories의 `color` 언급 삭제, 카테고리 API에 `PUT /api/categories/order`(요청 `{ ids: uuid[] }` — 전체 permutation 필수, 응답 `{ items }`) 추가, AI 응답 예시에 `summary`(한국어 1~3문장, ≤300자, optional-파싱/required-생성) 추가, 신규 카테고리 이름 규칙 "이모지 1개 + 공백 + 한국어 1~10자(zod max 16)" 반영. 문서에 없는 섹션은 새로 만들지 말고 기존 서술 위치를 수정한다.

- [ ] **Step 2: 전체 검증 루프**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`
Expected: 전부 통과. 실패 시 원인을 고치고 재실행 (skip/완화 금지).

- [ ] **Step 3: 수동 확인 (dev 스택)**

`bun run dev` 후:
1. 설정 → 카테고리: 색상 셀렉트가 없고, 위/아래 버튼으로 순서 변경 → 홈 칩 순서에 반영.
2. 북마크 추가(mode=ai, 새 주제 URL): 신규 카테고리가 `이모지 + 이름`으로 생성되고 칩/셀렉트에 표시.
3. 같은 북마크 카드: 제목 아래 1~3문장 요약이 최대 3줄로 표시.
4. 카드 메뉴: done 상태에서도 "AI 재분류"가 보이고, confirm 취소 시 아무 일 없음 / 확인 시 "분석중…" → 갱신.
5. AI 분류 실패 케이스(키 없는 provider 선택 등)에서 기존 description이 유지되는지.

브라우저 자동화가 불가하면 확인하지 못한 항목을 PROGRESS에 "사용자 확인 필요"로 남긴다 (완료로 주장하지 않는다).

- [ ] **Step 4: PROGRESS.md 갱신 + Commit**

결정 로그에 이 계획 상단 "결정 사항" 표의 항목들을 날짜와 함께 추가하고, 현재 상태 갱신.

```bash
git add -A
git commit -m "docs: 카테고리 개편과 AI 요약 변경 반영"
```

---

## 주의사항 (구현 세션 필독)

- **CLAUDE.md 작업 프로토콜을 따른다.** 라이브러리 API를 기억으로 쓰지 말 것 — 특히 zod v4 문법(`z.uuid()`, `z.enum(obj)`)과 lucide-react 아이콘 존재 여부는 `node_modules` 타입으로 확인.
- **`any`/`@ts-ignore` 금지.** supabase mock 타입이 안 맞으면 이 저장소의 기존 패턴(구조적 인터페이스 정의, `bookmark-tags.test.ts` 참고)을 따른다.
- Task 1의 `supabase db push`는 **원격 DB를 변경**한다. dry-run으로 0005 하나만 적용되는지 반드시 먼저 확인.
- Task 3에서 `zodTextFormat`이 optional 필드로 throw하는 경우의 대응은 Step 3 주의문에 명시된 경로만 사용한다.
- 각 Task 완료 시 커밋. 검증 실패 상태로 다음 Task로 넘어가지 않는다.
