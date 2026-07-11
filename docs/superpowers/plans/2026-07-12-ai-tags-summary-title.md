# AI 태그 및 한국어 요약 제목 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 분류 시 한국어 요약 제목과 태그 3~5개를 저장하고, 사용자가 태그를 편집·클릭·검색할 수 있게 한다.

**Architecture:** 북마크의 태그는 `text[]` 컬럼에 저장하고 Postgres RPC가 사용자 경계, 카테고리, 커서, 제목·URL·설명·태그 부분 검색을 한 번에 처리한다. AI provider 계약은 카테고리 결과와 `summaryTitle`, `tags`를 포함하는 루트 객체로 확장하며 분류 서비스가 pending 조건부 업데이트로 세 값을 원자적으로 적용한다.

**Tech Stack:** Bun workspaces, TypeScript 7 strict, Zod 4, Express 5, Supabase Postgres/PostgREST RPC, React 19, TanStack Query, Vitest, Biome

---

## 파일 구조

- Create: `supabase/migrations/0004_bookmark_tags.sql` — 태그 컬럼·GIN 인덱스·목록 검색 RPC
- Modify: `docs/02-database.md`, `docs/03-api.md`, `docs/05-ai.md` — 확정된 데이터/API/AI 명세 반영
- Modify: `packages/shared/src/index.ts` — 태그 스키마와 북마크 요청·응답 타입
- Modify: `packages/shared/src/__tests__/errors.test.ts` — 북마크 응답 태그 호환
- Modify: `packages/ai/src/types.ts` — AI 분석 결과 계약
- Modify: `packages/ai/src/schema.ts` — provider 공통 구조화 출력과 프롬프트
- Modify: `packages/ai/src/providers.ts` — 세 SDK의 새 응답 구조 적용
- Modify: `packages/ai/src/__tests__/provider.test.ts`, `packages/ai/src/__tests__/openai-schema.test.ts` — provider 회귀 테스트
- Modify: `apps/api/src/lib/db-mappers.ts` — DB `tags`를 API camelCase 모델로 변환
- Modify: `apps/api/src/services/categorize.ts` — 제목·태그의 pending 조건부 저장
- Modify: `apps/api/src/__tests__/categorize.test.ts` — 성공·실패·경쟁 상태 테스트
- Modify: `apps/api/src/routes/bookmarks.ts` — 태그 수정과 검색 RPC 호출
- Create: `apps/api/src/__tests__/bookmark-tags.test.ts` — HTTP 태그 수정·검색 경계 테스트
- Create: `apps/web/src/routes/_authed/-components/tag-input.tsx` — 태그 입력·칩 편집 전용 컴포넌트
- Create: `apps/web/src/routes/_authed/-components/tag-input.test.tsx` — 입력 동작 테스트
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx` — 편집 다이얼로그 태그 연결
- Modify: `apps/web/src/routes/_authed/index.tsx` — 카드 태그 표시와 클릭 검색
- Modify: `apps/web/src/routes/_authed/index.test.tsx` — 태그 표시·검색 회귀 테스트
- Modify: `PROGRESS.md` — 완료 내역과 검증 결과

### Task 1: DB 태그 저장과 검색 함수

**Files:**
- Create: `supabase/migrations/0004_bookmark_tags.sql`
- Modify: `docs/02-database.md`

- [ ] **Step 1: 마이그레이션 검증 SQL을 먼저 작성한다**

`0004_bookmark_tags.sql`의 트랜잭션 마지막에 실제 데이터 변경 없는 검증 가능한 객체를 정의한다. 검색 함수 시그니처는 다음으로 고정한다.

```sql
public.search_bookmarks(
  p_user_id uuid,
  p_query text,
  p_category_id uuid,
  p_uncategorized boolean,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
) returns setof public.bookmarks
```

- [ ] **Step 2: 빈 임시 DB 또는 SQL 파서에서 적용 전 실패를 확인한다**

Run: `bunx supabase db lint --local`
Expected: 로컬 Supabase가 없으면 연결 실패. 이 경우 SQL은 원격 적용 전에 리뷰하고 Task 8에서 `supabase db push --dry-run`으로 검증한다.

- [ ] **Step 3: 마이그레이션을 구현한다**

```sql
alter table public.bookmarks
  add column tags text[] not null default '{}';

alter table public.bookmarks
  add constraint bookmarks_tags_count_check
  check (cardinality(tags) <= 5);

create index bookmarks_tags_gin_idx
  on public.bookmarks using gin (tags);

create or replace function public.search_bookmarks(
  p_user_id uuid,
  p_query text default null,
  p_category_id uuid default null,
  p_uncategorized boolean default false,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 31
)
returns setof public.bookmarks
language sql
stable
security invoker
set search_path = ''
as $$
  select b.*
  from public.bookmarks b
  where b.user_id = p_user_id
    and (not p_uncategorized or b.category_id is null)
    and (p_category_id is null or b.category_id = p_category_id)
    and (
      p_query is null
      or b.title ilike '%' || p_query || '%'
      or b.url ilike '%' || p_query || '%'
      or b.description ilike '%' || p_query || '%'
      or exists (
        select 1 from unnest(b.tags) tag
        where tag ilike '%' || p_query || '%'
      )
    )
    and (
      p_cursor_created_at is null
      or (b.created_at, b.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by b.created_at desc, b.id desc
  limit least(greatest(p_limit, 1), 101);
$$;

revoke all on function public.search_bookmarks(uuid,text,uuid,boolean,timestamptz,uuid,integer) from public;
grant execute on function public.search_bookmarks(uuid,text,uuid,boolean,timestamptz,uuid,integer) to service_role;
```

- [ ] **Step 4: DB 문서를 갱신한다**

`docs/02-database.md`의 bookmarks 스키마에 `tags text[] not null default '{}'`를 추가하고 태그 배열 선택 이유, 5개 제한, GIN 인덱스와 `search_bookmarks` 사용자 경계를 기록한다.

- [ ] **Step 5: 변경을 커밋한다**

```bash
git add supabase/migrations/0004_bookmark_tags.sql docs/02-database.md
git commit -m "feat: 북마크 태그 스키마와 검색 함수 추가"
```

### Task 2: 공유 태그 스키마와 API 모델

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/__tests__/errors.test.ts`

- [ ] **Step 1: 실패하는 태그 검증 테스트를 작성한다**

```ts
import { bookmarkTagsSchema, updateBookmarkRequestSchema } from "../index";

it("normalizes editable bookmark tags", () => {
  expect(bookmarkTagsSchema.parse([" React ", "개발", "React"])).toEqual([
    "React",
    "개발",
  ]);
  expect(() => bookmarkTagsSchema.parse(["1", "2", "3", "4", "5", "6"])).toThrow();
  expect(() => bookmarkTagsSchema.parse(["가".repeat(21)])).toThrow();
  expect(updateBookmarkRequestSchema.parse({ tags: [] })).toEqual({ tags: [] });
});
```

기존 bookmark fixture에는 `tags: []`를 추가한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `bun run --cwd packages/shared test`
Expected: FAIL — `bookmarkTagsSchema`가 export되지 않음.

- [ ] **Step 3: 최소 스키마를 구현한다**

```ts
const bookmarkTagSchema = z.string().trim().min(1).max(20);

export const bookmarkTagsSchema = z
  .array(bookmarkTagSchema)
  .max(5)
  .transform((tags) => [...new Set(tags)]);
```

`bookmarkSchema`에 `tags: bookmarkTagsSchema`를 추가하고 `updateBookmarkRequestSchema`에 `tags: bookmarkTagsSchema.optional()`을 추가한다. API 응답 파싱에서는 이미 정규화된 DB 값을 그대로 통과시킨다.

- [ ] **Step 4: 공유 테스트와 타입 검사를 통과시킨다**

Run: `bun run --cwd packages/shared test && bun run --cwd packages/shared typecheck`
Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add packages/shared/src/index.ts packages/shared/src/__tests__/errors.test.ts
git commit -m "feat: 북마크 태그 공유 스키마 추가"
```

### Task 3: AI 응답 계약 확장

**Files:**
- Modify: `packages/ai/src/types.ts`
- Modify: `packages/ai/src/schema.ts`
- Modify: `packages/ai/src/providers.ts`
- Modify: `packages/ai/src/__tests__/provider.test.ts`
- Modify: `packages/ai/src/__tests__/openai-schema.test.ts`

- [ ] **Step 1: 세 provider의 실패 테스트를 작성한다**

provider mock 응답을 다음 형태로 변경하고 결과 전체를 검증한다.

```ts
const expected = {
  category: { type: "existing", categoryId: "cat-dev", confidence: 0.91 },
  summaryTitle: "React 19 핵심 변경 사항",
  tags: ["React", "프론트엔드", "자바스크립트"],
};
```

잘못된 응답 테스트도 추가한다.

```ts
expect(parseAnalyzeResponse({
  category: { type: "none" },
  summaryTitle: "가".repeat(41),
  tags: ["하나", "둘"],
})).toBeNull();
```

OpenAI mock은 `output_parsed: expected`를 반환하게 하고 `openai-schema.test.ts`는 새 루트 스키마가 `zodTextFormat`에서 throw하지 않는지 유지한다.

- [ ] **Step 2: AI 테스트의 예상 실패를 확인한다**

Run: `bun run --cwd packages/ai test`
Expected: FAIL — 기존 `CategorizeResult`만 반환함.

- [ ] **Step 3: 타입과 zod 스키마를 구현한다**

```ts
export interface AnalyzeResult {
  category: CategorizeResult;
  summaryTitle: string;
  tags: string[];
}

export interface AiProvider {
  readonly name: string;
  categorize(input: CategorizeInput): Promise<AnalyzeResult>;
  validateConnection(): Promise<void>;
}
```

```ts
export const analyzeResponseSchema = z.object({
  category: categorizeResponseSchema,
  summaryTitle: z.string().trim().min(1).max(40),
  tags: z.array(z.string().trim().min(1).max(20)).min(3).max(5)
    .refine((tags) => new Set(tags).size === tags.length),
});
```

`parseAnalyzeResponse`는 `safeParse` 실패 시 경고 후 `null`을 반환한다. provider는 잘못된 AI 응답을 성공적인 `none`으로 숨기지 말고 throw하여 서비스가 `ai_status='failed'`로 전이하게 한다.

- [ ] **Step 4: provider별 구조화 출력과 프롬프트를 변경한다**

- Gemini `responseSchema`: 루트 object 안에 `category`, `summaryTitle`, `tags`를 정의
- Anthropic tool input schema: 동일한 루트 object
- OpenAI `zodTextFormat(analyzeResponseSchema, "bookmark_analysis")`
- 프롬프트: “제목은 한국어 제목 스타일 최대 40자, 태그는 한국어 3~5개. 고유 기술명은 원문 허용” 규칙 추가

각 SDK 응답은 `parseAnalyzeResponse`를 거친 뒤 반환한다.

- [ ] **Step 5: AI 테스트·타입·lint를 통과시킨다**

Run: `bun run --cwd packages/ai test && bun run --cwd packages/ai typecheck && bun run --cwd packages/ai lint`
Expected: 2개 테스트 파일 모두 PASS, 경고 없음.

- [ ] **Step 6: 커밋한다**

```bash
git add packages/ai/src/types.ts packages/ai/src/schema.ts packages/ai/src/providers.ts packages/ai/src/__tests__/provider.test.ts packages/ai/src/__tests__/openai-schema.test.ts
git commit -m "feat: AI 한국어 제목과 태그 응답 추가"
```

### Task 4: 분류 서비스에서 제목·태그 적용

**Files:**
- Modify: `apps/api/src/services/categorize.ts`
- Modify: `apps/api/src/__tests__/categorize.test.ts`

- [ ] **Step 1: 저장 동작의 실패 테스트를 작성한다**

fake provider가 다음을 반환하게 한다.

```ts
{
  category: { type: "none" },
  summaryTitle: "웹 접근성 실전 안내",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
}
```

최종 update가 다음 값을 한 번에 포함하는지 검증한다.

```ts
expect(update).toHaveBeenCalledWith({
  category_id: null,
  title: "웹 접근성 실전 안내",
  tags: ["웹 접근성", "프론트엔드", "사용자 경험"],
  ai_status: "done",
});
```

provider throw 시 metadata 제목만 유지되고 AI 제목·태그 update가 발생하지 않으며 failed update만 발생하는 테스트를 추가한다.

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `bun run --cwd apps/api test src/__tests__/categorize.test.ts`
Expected: FAIL — `result.category`, `summaryTitle`, `tags`가 처리되지 않음.

- [ ] **Step 3: 분류 적용 함수를 최소 변경한다**

`applyCategorizeResult`의 입력을 `AnalyzeResult`로 바꾸고 카테고리 ID를 먼저 결정한 뒤 다음 단일 update를 실행한다.

```ts
.update({
  category_id: categoryId,
  title: result.summaryTitle,
  tags: result.tags,
  ai_status: "done",
})
.eq("user_id", userId)
.eq("id", bookmarkId)
.eq("ai_status", "pending");
```

카테고리 생성 로직은 유지하되 `markDone`이 title/tags를 받도록 변경한다. metadata update와 AI 완료 update 모두 pending 조건을 유지한다.

- [ ] **Step 4: API 서비스 테스트와 타입 검사를 통과시킨다**

Run: `bun run --cwd apps/api test src/__tests__/categorize.test.ts && bun run --cwd apps/api typecheck`
Expected: PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/api/src/services/categorize.ts apps/api/src/__tests__/categorize.test.ts
git commit -m "feat: AI 제목과 태그를 북마크에 적용"
```

### Task 5: 북마크 API 태그 수정과 검색 RPC

**Files:**
- Modify: `apps/api/src/lib/db-mappers.ts`
- Modify: `apps/api/src/routes/bookmarks.ts`
- Create: `apps/api/src/__tests__/bookmark-tags.test.ts`
- Modify: `docs/03-api.md`

- [ ] **Step 1: HTTP 실패 테스트를 작성한다**

`bookmark-tags.test.ts`에서 인증 verifier와 DB를 주입하는 기존 route 테스트 패턴을 사용해 다음을 검증한다.

```ts
it("updates normalized bookmark tags", async () => {
  const response = await request(app)
    .patch(`/api/bookmarks/${bookmarkId}`)
    .set("Authorization", "Bearer valid")
    .send({ tags: [" React ", "개발", "React"] });
  expect(response.status).toBe(200);
  expect(dbUpdate).toHaveBeenCalledWith({ tags: ["React", "개발"] });
});

it("rejects more than five tags", async () => {
  const response = await request(app)
    .patch(`/api/bookmarks/${bookmarkId}`)
    .set("Authorization", "Bearer valid")
    .send({ tags: ["1", "2", "3", "4", "5", "6"] });
  expect(response.status).toBe(400);
});
```

목록 테스트는 RPC 인자가 사용자 ID, q, 카테고리, 커서, `limit + 1`을 포함하는지 검증한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `bun run --cwd apps/api test src/__tests__/bookmark-tags.test.ts`
Expected: FAIL — mapper와 route가 tags/RPC를 지원하지 않음.

- [ ] **Step 3: DB mapper와 PATCH를 구현한다**

`BookmarkDbRow`에 `tags: string[]`를 추가하고 `mapBookmark`가 `tags: row.tags`를 반환한다. `BookmarkUpdate`에도 `tags?: string[]`를 추가하고 PATCH route에 다음을 추가한다.

```ts
if (body.tags !== undefined) {
  updates.tags = body.tags;
}
```

- [ ] **Step 4: 목록 route를 RPC로 교체한다**

```ts
const cursor = query.cursor ? decodeCursor(query.cursor) : null;
const { data, error } = await db.rpc("search_bookmarks", {
  p_user_id: userId,
  p_query: query.q ?? null,
  p_category_id:
    query.categoryId && query.categoryId !== "none" ? query.categoryId : null,
  p_uncategorized: query.categoryId === "none",
  p_cursor_created_at: cursor?.createdAt ?? null,
  p_cursor_id: cursor?.id ?? null,
  p_limit: query.limit + 1,
});
```

기존 page slice와 cursor 응답 생성은 유지한다.

- [ ] **Step 5: API 문서를 갱신한다**

`docs/03-api.md`에 `tags` 응답, PATCH `tags`, q의 태그 부분 검색, 태그 클릭이 기존 q를 사용한다는 점을 기록한다.

- [ ] **Step 6: API 테스트·타입·lint를 통과시킨다**

Run: `bun run --cwd apps/api test && bun run --cwd apps/api typecheck && bun run --cwd apps/api lint`
Expected: 전체 API 테스트 PASS, 경고 없음.

- [ ] **Step 7: 커밋한다**

```bash
git add apps/api/src/lib/db-mappers.ts apps/api/src/routes/bookmarks.ts apps/api/src/__tests__/bookmark-tags.test.ts docs/03-api.md
git commit -m "feat: 태그 수정과 통합 검색 API 추가"
```

### Task 6: 태그 입력 컴포넌트와 편집 다이얼로그

**Files:**
- Create: `apps/web/src/routes/_authed/-components/tag-input.tsx`
- Create: `apps/web/src/routes/_authed/-components/tag-input.test.tsx`
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`

- [ ] **Step 1: TagInput 실패 테스트를 작성한다**

```tsx
it("adds tags with Enter and comma and removes a chip", async () => {
  const onChange = vi.fn();
  render(<TagInput value={["개발"]} onChange={onChange} />);
  await userEvent.type(screen.getByLabelText("태그"), "React{Enter}");
  expect(onChange).toHaveBeenCalledWith(["개발", "React"]);
  await userEvent.click(screen.getByRole("button", { name: "개발 태그 삭제" }));
  expect(onChange).toHaveBeenCalledWith([]);
});

it("does not add more than five tags", async () => {
  render(<TagInput value={["1", "2", "3", "4", "5"]} onChange={vi.fn()} />);
  expect(screen.getByText("태그는 최대 5개까지 추가할 수 있어요.")).toBeDefined();
  expect(screen.getByLabelText("태그")).toBeDisabled();
});
```

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `bun run --cwd apps/web test src/routes/_authed/-components/tag-input.test.tsx`
Expected: FAIL — 컴포넌트가 없음.

- [ ] **Step 3: TagInput을 구현한다**

named export `TagInput`을 만들고 props는 다음으로 고정한다.

```ts
interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
}
```

입력은 Enter, 쉼표, blur에서 trim한 값을 추가한다. 빈 값과 중복은 무시하며 20자 초과는 추가하지 않고 안내한다. 각 칩은 `aria-label="${tag} 태그 삭제"` 버튼을 가진다.

- [ ] **Step 4: 편집 다이얼로그 mutation에 연결한다**

`EditBookmarkDialog`에 `const [tags, setTags] = useState(bookmark.tags)`를 추가하고 `<TagInput value={tags} onChange={setTags} />`를 렌더링한다. PATCH body에 `tags`를 포함하고 성공 시 기존 `['bookmarks']` invalidate 흐름을 유지한다.

- [ ] **Step 5: 웹 컴포넌트 테스트·타입·lint를 통과시킨다**

Run: `bun run --cwd apps/web test src/routes/_authed/-components/tag-input.test.tsx && bun run --cwd apps/web typecheck && bun run --cwd apps/web lint`
Expected: PASS.

- [ ] **Step 6: 커밋한다**

```bash
git add apps/web/src/routes/_authed/-components/tag-input.tsx apps/web/src/routes/_authed/-components/tag-input.test.tsx apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx
git commit -m "feat: 북마크 태그 편집 UI 추가"
```

### Task 7: 카드 태그 표시와 클릭 검색

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/routes/_authed/index.test.tsx`

- [ ] **Step 1: 카드 태그 실패 테스트를 작성한다**

```tsx
it("shows bookmark tags and searches when a tag is clicked", async () => {
  renderHomeWithBookmark({
    title: "React 19 핵심 변경 사항",
    tags: ["React", "프론트엔드", "웹 개발"],
  });
  expect(screen.getByText("React 19 핵심 변경 사항")).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "React 태그 검색" }));
  expect(screen.getByPlaceholderText("북마크 검색")).toHaveValue("React");
});
```

태그가 빈 배열이면 태그 버튼이 렌더링되지 않는 테스트도 추가한다.

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `bun run --cwd apps/web test src/routes/_authed/index.test.tsx`
Expected: FAIL — 카드가 tags를 렌더링하지 않음.

- [ ] **Step 3: 검색 setter를 카드에 전달한다**

`BookmarkCard` props에 `onTagSearch: (tag: string) => void`를 추가한다. 목록 렌더링에서 `onTagSearch={setSearch}`를 전달한다. 클릭 시 외부 링크 이동과 카드 메뉴 동작을 막기 위해 태그는 `<button type="button">`으로 렌더링한다.

```tsx
<div className="mt-2 flex flex-wrap gap-1.5">
  {bookmark.tags.map((tag) => (
    <button
      key={tag}
      type="button"
      aria-label={`${tag} 태그 검색`}
      onClick={() => onTagSearch(tag)}
      className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
    >
      {tag}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 웹 전체 테스트를 통과시킨다**

Run: `bun run --cwd apps/web test && bun run --cwd apps/web typecheck && bun run --cwd apps/web lint`
Expected: 전체 웹 테스트 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/web/src/routes/_authed/index.tsx apps/web/src/routes/_authed/index.test.tsx
git commit -m "feat: 북마크 카드 태그 검색 추가"
```

### Task 8: 문서·원격 마이그레이션·전체 검증

**Files:**
- Modify: `docs/05-ai.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: AI 문서를 갱신한다**

`docs/05-ai.md`의 계약과 프롬프트에 `summaryTitle` 최대 40자, 한국어 태그 3~5개, 고유명사 원문 허용, 성공 시 제목·태그 저장, 실패 시 기존 값 보존을 기록한다. 기존 15초 timeout과 재시도 없음 정책은 유지한다.

- [ ] **Step 2: 로컬 전체 검증 루프를 실행한다**

Run:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: 모든 workspace 성공, 모든 테스트 PASS, build exit 0.

- [ ] **Step 3: 마이그레이션 dry-run 후 원격에 적용한다**

Run:

```bash
bunx supabase db push --dry-run
bunx supabase db push
```

Expected: `0004_bookmark_tags.sql`만 적용되고 오류 없음.

- [ ] **Step 4: DB 객체를 검증한다**

Supabase MCP read-only SQL로 다음을 확인한다.

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'bookmarks' and column_name = 'tags';

select routine_name
from information_schema.routines
where routine_schema = 'public' and routine_name = 'search_bookmarks';
```

Expected: `tags`는 ARRAY, not null, 기본값 `{}`이며 `search_bookmarks`가 존재.

- [ ] **Step 5: 실제 API와 UI를 수동 검증한다**

1. `mode=ai`로 북마크 생성
2. pending이 done으로 바뀐 뒤 제목이 한국어 40자 이내인지 확인
3. 태그가 3~5개인지 확인
4. 카드 태그 클릭 후 검색 결과가 해당 태그 북마크만 포함하는지 확인
5. 편집 화면에서 태그 추가·삭제 후 새로고침해 유지되는지 확인
6. 카테고리 필터와 태그 검색을 동시에 적용
7. 다른 사용자 ID로 RPC를 호출할 수 없고 API가 인증 userId만 전달하는지 테스트로 재확인

- [ ] **Step 6: PROGRESS를 갱신한다**

완료 기능, 마이그레이션 적용 여부, 전체 테스트 수, 실제 OpenAI/Gemini/Anthropic 중 검증한 provider, 남은 실기기 항목을 `PROGRESS.md`에 기록한다.

- [ ] **Step 7: 최종 문서와 진행 로그를 커밋한다**

```bash
git add docs/05-ai.md PROGRESS.md
git commit -m "docs: AI 태그와 요약 제목 구현 기록"
```
