# Bookmark Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable key-value metadata to every bookmark and automatically attach a safe Naver Map search link when AI confidently identifies a restaurant.

**Architecture:** Store validated `Record<string, string>` data in one `bookmarks.metadata jsonb` column and return it through the existing bookmark API. Keep place recognition structured and separate from storage: the AI returns a nullable place candidate, while Express applies the confidence threshold and constructs the Naver URL before merging only the `네이버지도` key. A reusable web renderer and editor serve link cards, image cards, and image detail without map-specific UI.

**Tech Stack:** Supabase Postgres, Express 5, Zod, OpenRouter strict JSON Schema, React 19, TanStack Query, Vitest, Testing Library, TypeScript 7, Biome.

---

## File map

- `supabase/migrations/<timestamp>_bookmark_metadata.sql`: add JSONB storage and recreate `search_bookmarks` with metadata in its row type.
- `packages/shared/src/index.ts`: define the normalized metadata schema and include it in bookmark/update contracts.
- `packages/shared/src/__tests__/bookmark-metadata.test.ts`: boundary normalization and rejection coverage.
- `packages/ai/src/types.ts`, `packages/ai/src/schema.ts`: nullable `place` candidate in provider output and strict schema/prompt.
- `packages/ai/src/__tests__/provider.test.ts`: structured place parsing and prompt coverage.
- `apps/api/src/services/categorize.ts`: confidence gate, safe URL construction, merge with user metadata.
- `apps/api/src/lib/db-mappers.ts`, `apps/api/src/routes/bookmarks.ts`: DB/API mapping and PATCH persistence.
- `apps/api/src/__tests__/categorize.test.ts`, `apps/api/src/__tests__/bookmark-tags.test.ts`, `apps/api/src/__tests__/bookmark-query.test.ts`: service and route regressions.
- `apps/web/src/routes/_authed/-components/bookmark-metadata.tsx`: shared metadata display and row editor.
- `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`: metadata form state and PATCH payload.
- `apps/web/src/routes/_authed/index.tsx`, `apps/web/src/routes/_authed/images.$id.tsx`: card/detail rendering.
- `apps/web/src/routes/_authed/-index.test.tsx`, `apps/web/src/routes/_authed/-image-detail.test.tsx`, `apps/web/src/routes/_authed/-components/tag-input.test.tsx`: UI behavior.
- `docs/02-database.md`, `docs/03-api.md`, `docs/05-ai.md`, `PROGRESS.md`: source-of-truth and verification record.

### Task 1: Shared contract and database migration

- [ ] **Step 1: Write failing shared tests**

Create cases that parse `{ "지역": " 서울 성수동 " }` to `{ "지역": "서울 성수동" }`, accept `{}`, and reject more than 10 entries, blank values, keys longer than 40, values longer than 2048, and `__proto__`/`prototype`/`constructor`.

- [ ] **Step 2: Run the shared test and verify RED**

Run: `bun run --cwd packages/shared test -- src/__tests__/bookmark-metadata.test.ts`

Expected: FAIL because `bookmarkMetadataSchema` and bookmark `metadata` do not exist.

- [ ] **Step 3: Implement the normalized record schema**

Export `bookmarkMetadataSchema` as a `z.record(z.string(), z.string())` transform/refinement that creates a plain object from trimmed entries and enforces the limits. Extend the common bookmark fields with `metadata`, and add optional `metadata` to `updateBookmarkRequestSchema`.

- [ ] **Step 4: Create and fill the migration**

Run `bun x supabase migration new bookmark_metadata`, then add:

```sql
alter table public.bookmarks
  add column metadata jsonb not null default '{}'::jsonb,
  add constraint bookmarks_metadata_object_check
    check (jsonb_typeof(metadata) = 'object');
```

Recreate the current image-aware `search_bookmarks` signature and add `metadata jsonb` to `returns table` plus `b.metadata` to the SELECT in the same ordinal position used by the mapper.

- [ ] **Step 5: Run shared tests and migration checks GREEN**

Run: `bun run --cwd packages/shared test && git diff --check`

Expected: all shared tests pass and the diff has no whitespace errors.

### Task 2: Structured place analysis and server-owned Naver URL

- [ ] **Step 1: Write failing AI parser tests**

Add one response with `place: { name: "호랑이식당 성수점", locality: "서울 성동구", confidence: 0.92 }`, one with `place: null`, and malformed confidence/name cases. Assert `jsonSchema.required` contains `place`, its value accepts object or null, and the prompt says not to infer a restaurant name from food alone.

- [ ] **Step 2: Run AI tests RED**

Run: `bun run --cwd packages/ai test -- src/__tests__/provider.test.ts`

Expected: FAIL because `AnalyzeResult.place` is missing.

- [ ] **Step 3: Implement nullable place schema**

Add:

```ts
export interface PlaceCandidate {
  name: string;
  locality: string | null;
  confidence: number;
}
```

Make `AnalyzeResult.place` nullable, mirror it in zod and strict JSON Schema, and update prompts so directly evidenced restaurants only produce a candidate.

- [ ] **Step 4: Write failing categorize service tests**

Cover confidence `0.85` creating `https://map.naver.com/p/search/${encodeURIComponent("호랑이식당 성수점 서울 성동구")}`, `0.849` leaving metadata unchanged, and a confident candidate replacing only `네이버지도` while preserving `{ "예약메모": "창가 자리" }`.

- [ ] **Step 5: Implement the confidence gate and merge**

Add a focused helper returning `Record<string, string>`:

```ts
const NAVER_MAP_KEY = "네이버지도";
const PLACE_CONFIDENCE_THRESHOLD = 0.85;
```

Read `metadata` with the bookmark row, merge the generated link into it before the existing pending-guarded update, and omit the metadata update when no qualifying candidate exists.

- [ ] **Step 6: Run AI and API service tests GREEN**

Run: `bun run --cwd packages/ai test && bun run --cwd apps/api test -- src/__tests__/categorize.test.ts`

Expected: all targeted tests pass.

### Task 3: API mapping and editable metadata

- [ ] **Step 1: Write failing mapper/route tests**

Assert list/detail mapping returns metadata, PATCH sends normalized metadata to Supabase, `{}` clears it, and a metadata patch adds `ai_status: "idle"`. Assert omitted metadata does not touch the column.

- [ ] **Step 2: Run API tests RED**

Run: `bun run --cwd apps/api test -- src/__tests__/bookmark-tags.test.ts src/__tests__/bookmark-query.test.ts`

Expected: FAIL because the row mapper and update object omit metadata.

- [ ] **Step 3: Implement DB/API mapping**

Add `metadata: unknown` to `BookmarkDbRow`, parse it with the shared schema in `mapBookmark`, add `metadata?: Record<string, string>` to `BookmarkUpdate`, and include metadata in the manual-edit status reset condition.

- [ ] **Step 4: Run API tests GREEN**

Run: `bun run --cwd apps/api test -- src/__tests__/bookmark-tags.test.ts src/__tests__/bookmark-query.test.ts src/__tests__/categorize.test.ts`

Expected: all targeted tests pass.

### Task 4: Shared metadata renderer and editor

- [ ] **Step 1: Write failing UI tests**

Assert a link card and image card render `네이버지도` as an anchor with `target="_blank"` and `rel="noreferrer"`, a plain `지역` value renders as text, the image metadata anchor does not activate `/images/:id`, and image detail renders both forms.

- [ ] **Step 2: Run UI rendering tests RED**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx src/routes/_authed/-image-detail.test.tsx`

Expected: FAIL because no metadata renderer exists.

- [ ] **Step 3: Create the renderer**

Create `BookmarkMetadata` that parses candidate URL values with `new URL`, accepts only `http:`/`https:`, renders safe external anchors, and renders all other entries as labelled text. Keep it generic; do not branch on `네이버지도`.

- [ ] **Step 4: Integrate cards and detail**

Render it between description and tags. Give the image-card wrapper `relative z-10 pointer-events-auto` so metadata anchors win over the full-card internal link.

- [ ] **Step 5: Write failing editor tests**

Open `EditBookmarkDialog`, verify existing entries, add and delete rows, submit trimmed metadata, and block partial/duplicate rows and an eleventh entry.

- [ ] **Step 6: Implement `BookmarkMetadataEditor`**

Use controlled `{ key, value }[]` rows. Convert valid trimmed rows into a plain record at submit time and pass it through `updateBookmark`. Show Korean inline validation and disable `항목 추가` at 10 rows.

- [ ] **Step 7: Run all targeted web tests GREEN**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx src/routes/_authed/-image-detail.test.tsx src/routes/_authed/-components/tag-input.test.tsx`

Expected: all targeted tests pass.

### Task 5: Documentation, full verification, and live two-image check

- [ ] **Step 1: Update source-of-truth docs**

Document the JSONB column and non-search decision in `docs/02-database.md`, response/PATCH contract in `docs/03-api.md`, and place threshold/server URL construction in `docs/05-ai.md`.

- [ ] **Step 2: Run the full local verification loop**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`

Expected: all commands exit 0 with no skipped failing tests.

- [ ] **Step 3: Apply and verify the linked migration**

Inspect `bun x supabase db push --help`, push the new migration to the linked project, then verify local/remote migration lists match and remote database lint reports no schema errors.

- [ ] **Step 4: Reanalyze the two existing restaurant images**

Authenticate with the existing test account without printing credentials or signed URLs. Query image bookmarks, identify the two restaurant images from their current title/thumbnail, call `POST /api/bookmarks/:id/categorize` for only those ids, poll detail responses until `aiStatus` leaves `pending`, and assert each successful result has a `네이버지도` value whose parsed host is `map.naver.com`. Report booleans and titles only; never print signed media URLs or authorization values.

- [ ] **Step 5: Update PROGRESS and commit**

Record automatic verification, migration state, and the two-item live result. Commit coherent implementation units using Korean conventional messages.
