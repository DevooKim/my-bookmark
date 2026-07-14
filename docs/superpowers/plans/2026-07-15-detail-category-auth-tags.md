# Detail, Mobile Category, Session, and Tag Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine image detail metadata, repair the mobile category row layout, redirect expired web sessions to login, and generate concise non-restaurant-name AI tags.

**Architecture:** Keep UI changes local to existing components and centralize terminal Bearer-session handling in `api-client.ts`. Change the AI boundary to accept 2–5 tags, express semantic selection rules in the prompt, and add a narrow server sanitizer that removes only tags equal to the detected `place.name`.

**Tech Stack:** TypeScript 7, React 19, TanStack Query/Router, Tailwind CSS v4, Zod, Express 5, Vitest, Testing Library, Bun workspaces.

---

## File map

- `apps/web/src/routes/_authed/images.$id.tsx`: created date detail and removal of file/status footer.
- `apps/web/src/routes/_authed/-image-detail.test.tsx`: detail content regression.
- `apps/web/src/routes/_authed/-components/bookmark-metadata.tsx`: Naver Map-only hover style.
- `apps/web/src/routes/_authed/-index.test.tsx`: metadata link style regression.
- `apps/web/src/routes/_authed/-components/sortable-list.tsx`: optional drag-handle layout class.
- `apps/web/src/routes/_authed/settings.tsx`: mobile two-row category layout.
- `apps/web/src/routes/_authed/-settings.test.tsx`: responsive class regression.
- `apps/web/src/lib/auth-redirect.ts`: testable current-location login navigation helper.
- `apps/web/src/lib/auth-redirect.test.ts`: redirect URL and navigation boundary tests.
- `apps/web/src/lib/api-client.ts`: terminal session redirect and 401 error.
- `apps/web/src/lib/api-client.test.ts`: missing/expired session boundary tests.
- `packages/ai/src/schema.ts`: 2–5 tag schema, strict schema limits, and prompt rules.
- `packages/ai/src/__tests__/provider.test.ts`: tag contract and prompt regressions.
- `apps/api/src/services/categorize.ts`: restaurant-name tag sanitizer.
- `apps/api/src/__tests__/categorize.test.ts`: sanitizer integration.
- `docs/05-ai.md`, `docs/07-ui.md`, `PROGRESS.md`: source-of-truth and completion record.

### Task 1: Image detail date and metadata hover

- [ ] **Step 1: Add failing detail and metadata tests**

In `-image-detail.test.tsx`, assert `등록일` and the Korean formatted `createdAt` are present while `sample.png`, `2×2`, `5.5 MB`, and `분석 완료` are absent. Assert the `네이버지도` link contains `hover:bg-[#03c75a]` and `hover:text-white`. In `_index.test.tsx`, prove another URL metadata key does not receive the green hover class.

- [ ] **Step 2: Verify RED**

Run:

```bash
bun run --cwd apps/web test -- src/routes/_authed/-image-detail.test.tsx src/routes/_authed/-index.test.tsx
```

Expected: FAIL because the old footer remains and all URL metadata links share the blue hover style.

- [ ] **Step 3: Implement the detail and hover changes**

Replace the file-size formatter/footer in `images.$id.tsx` with:

```ts
const createdDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
});
```

Render `등록일 {createdDateFormatter.format(new Date(bookmark.createdAt))}`. In `BookmarkMetadata`, select a map-only hover fragment when `key === "네이버지도"` and retain the existing hover fragment for all other URLs.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect both suites to pass.

### Task 2: Mobile category row layout

- [ ] **Step 1: Add a failing responsive layout test**

In `-settings.test.tsx`, locate a category input and its row. Assert the row uses mobile `grid-cols-[auto_minmax(0,1fr)_auto]` plus desktop `sm:grid-cols-[auto_1fr_80px_auto]`, the handle uses `row-span-2 sm:row-span-1`, and the input uses `col-span-2 min-w-0 sm:col-span-1`.

- [ ] **Step 2: Verify RED**

Run `bun run --cwd apps/web test -- src/routes/_authed/-settings.test.tsx` and expect the responsive class assertions to fail.

- [ ] **Step 3: Add the narrow layout hook and classes**

Add `handleClassName?: string` to `SortableRow` and compose it after the default icon classes:

```tsx
className={`icon-button cursor-grab touch-none ${handleClassName ?? ""}`}
```

Use the mobile/desktop row classes from Step 1 in `CategoryRow`, pass the row-span classes to the handle, add the input span/min-width classes, and position count/delete in the second mobile row while resetting placement at `sm`.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect all settings tests to pass.

### Task 3: Terminal web session redirect

- [ ] **Step 1: Add failing API-client tests**

Refactor the Supabase mock so each test can control `getSession` and `refreshSession`. Add cases for:

```ts
getSession -> session null
first fetch 401 -> refreshSession error
first fetch 401 -> refreshed token -> second fetch 401
first fetch 502
```

Mock the navigation helper in `api-client.test.ts`. For the first three, assert it is called and the request rejects with `{ status: 401 }`. For 502, assert no navigation and the normal API error remains 502. In `auth-redirect.test.ts`, inject `{ pathname: "/images/id", search: "?view=preview" }` and an `assign` spy, then assert the exact `/login?redirect=%2Fimages%2Fid%3Fview%3Dpreview` URL.

- [ ] **Step 2: Verify RED**

Run `bun run --cwd apps/web test -- src/lib/api-client.test.ts` and expect missing-session/terminal-401 redirect assertions to fail.

- [ ] **Step 3: Implement centralized expiry handling**

Add this testable helper to `auth-redirect.ts`:

```ts
export function navigateToLogin(
  location: LocationParts = window.location,
  assign: (url: string) => void = (url) => window.location.assign(url),
): void {
  assign(loginUrlForLocation(location));
}
```

Import `navigateToLogin` in `api-client.ts`. Add an internal `throwExpiredSession()` that calls it and then throws `new ApiClientError("로그인이 필요합니다", 401)`. Call it when no initial token exists, refresh throws or returns no token, or the one retried response remains 401. Return non-401 responses unchanged and never retry more than once.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect all API-client tests to pass.

### Task 4: AI tag contract and selection prompt

- [ ] **Step 1: Add failing provider tests**

Prove a two-tag response parses, a one-tag response fails, `jsonSchema.properties.tags` has `minItems: 2` and `maxItems: 5`, and `systemPrompt()` contains rules for stopping at two, avoiding the exact example groups (`TrueNAS/NAS`, `돈까스/돈카츠/미소카츠`, regional 맛집 variants), and excluding restaurant/branch names.

- [ ] **Step 2: Verify RED**

Run `bun run --cwd packages/ai test -- src/__tests__/provider.test.ts` and expect the two-tag/strict-schema/prompt assertions to fail.

- [ ] **Step 3: Implement the contract and prompt**

Change the Zod array minimum to 2 and the strict JSON Schema tag node to:

```ts
tags: {
  type: "array" as const,
  items: { type: "string" as const },
  minItems: 2,
  maxItems: 5,
},
```

Replace prompt rule 7 with the approved 2–5 rule and add explicit no-padding, semantic-duplicate, regional variant, and restaurant-name rules without changing unrelated category/place/source instructions.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect all provider tests to pass.

### Task 5: Restaurant-name tag defense

- [ ] **Step 1: Add a failing categorize test**

Call `applyCategorizeResult` with `place.name = "신죠오 사사게요 천호점"` and tags including `"신죠오 사사게요 천호점"`, a punctuation/spacing variant, `"미소카츠"`, and `"천호"`. Assert the stored tags keep only `미소카츠`, `천호`, while category/title/AI status still complete.

- [ ] **Step 2: Verify RED**

Run `bun run --cwd apps/api test -- src/__tests__/categorize.test.ts` and expect the restaurant-name tag assertion to fail.

- [ ] **Step 3: Implement the narrow sanitizer**

Add a normalizer that lowercases and removes Unicode characters other than letters/numbers. Add:

```ts
export function removePlaceNameTags(
  tags: string[],
  placeName: string | null | undefined,
): string[]
```

Return unchanged tags without a place name; otherwise remove only tags whose normalized value exactly equals the normalized place name. Pass the sanitized result into `markDone` without mutating the provider result or applying semantic heuristics.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect all categorize tests to pass.

### Task 6: Documentation and focused verification

- [ ] **Step 1: Update source-of-truth docs**

Update `docs/05-ai.md` from 3–5 to 2–5 tags and document no-padding/semantic-duplicate/restaurant-name behavior. Update `docs/07-ui.md` with the detail registration date, map hover, responsive category row, and terminal session redirect behavior.

- [ ] **Step 2: Run focused verification**

Run:

```bash
bun run --cwd packages/ai test
bun run --cwd apps/api test -- src/__tests__/categorize.test.ts
bun run --cwd apps/web test -- src/lib/auth-redirect.test.ts src/lib/api-client.test.ts src/routes/_authed/-image-detail.test.tsx src/routes/_authed/-index.test.tsx src/routes/_authed/-settings.test.tsx
```

Expected: all focused suites pass.

### Task 7: Full verification, progress, and commit

- [ ] **Step 1: Run the repository verification loop**

Run sequentially:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
```

Expected: every command exits 0. Existing informational lint/build warnings may remain but no new warning is accepted.

- [ ] **Step 2: Update `PROGRESS.md`**

Record the four completed areas, the session-expiry root cause, 2–5 tag policy and exact restaurant-name defense, test totals, and any remaining browser/live-AI checks.

- [ ] **Step 3: Mark this plan complete and inspect the patch**

Change every checkbox in this file to `[x]`, run `git diff --check`, inspect `git status --short`, and confirm no unrelated files are staged.

- [ ] **Step 4: Commit the implementation**

Stage only the files listed in this plan and commit with:

```bash
git commit -m "feat: 상세 UI와 세션 태그 흐름 개선"
```
