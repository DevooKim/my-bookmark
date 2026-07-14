# Unified iOS Share API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one `/api/share` multipart endpoint that accepts either a URL text field or an image file from a single iOS Shortcut while preserving the existing bookmark and image APIs.

**Architecture:** Extract link and image creation orchestration into focused services, leaving HTTP parsing and authentication in route modules. The share router accepts one multipart field named `item`, rejects ambiguous input, and delegates to the same creation services as `/api/bookmarks` and `/api/images`.

**Tech Stack:** Express 5, Multer 2, Zod, Supabase, Vitest/Supertest, TypeScript 7, Bun workspaces

---

## File map

- Create `apps/api/src/services/bookmark-creation.ts`: shared link insert, duplicate mapping, and background metadata/AI orchestration.
- Create `apps/api/src/services/image-bookmark-creation.ts`: shared image processing, Storage/DB durability, background AI, and signed thumbnail orchestration.
- Create `apps/api/src/routes/share.ts`: multipart `item` parsing and link/image delegation.
- Create `apps/api/src/__tests__/share-routes.test.ts`: unified endpoint behavior and authentication boundary.
- Modify `apps/api/src/routes/bookmarks.ts`: delegate POST creation to the link creation service.
- Modify `apps/api/src/routes/images.ts`: delegate POST creation to the image creation service.
- Modify `apps/api/src/app.ts`: mount the share router and include `/share` in API Key rate limiting.
- Modify `apps/api/src/__tests__/app-auth-order.test.ts`: lock the `/share` API Key rate-limit boundary.
- Modify `docs/03-api.md` and `docs/shortcuts-guide.md`: document the endpoint and single-shortcut recipe.
- Modify `PROGRESS.md`: record implementation decisions, verification totals, and iPhone manual checks.

### Task 1: Extract creation services without changing existing APIs

**Files:**
- Create: `apps/api/src/services/bookmark-creation.ts`
- Create: `apps/api/src/services/image-bookmark-creation.ts`
- Modify: `apps/api/src/routes/bookmarks.ts`
- Modify: `apps/api/src/routes/images.ts`
- Test: `apps/api/src/__tests__/images.test.ts`
- Test: existing bookmark route and categorization tests

- [ ] **Step 1: Run the existing route tests as the refactor baseline**

Run:

```bash
bun run --cwd apps/api test -- images.test.ts bookmark-tags.test.ts categorize.test.ts
```

Expected: all selected tests pass before extraction.

- [ ] **Step 2: Extract link creation orchestration**

Define a dependency boundary that owns persistence but leaves the sequence testable:

```ts
export interface LinkBookmarkCreationDeps {
  assertCategory(userId: string, categoryId: string): Promise<void>;
  insert(input: {
    userId: string;
    url: string;
    title: string | null;
    categoryId: string | null;
    aiStatus: "pending" | "idle";
  }): Promise<BookmarkDbRow>;
  existingId(userId: string, url: string): Promise<string | undefined>;
  categorize(userId: string, bookmarkId: string): Promise<void>;
  updateMetadata(input: {
    userId: string;
    bookmarkId: string;
    url: string;
    title: string | null;
  }): Promise<void>;
}

export async function createLinkBookmark(
  input: { userId: string; request: CreateBookmarkRequest },
  deps: LinkBookmarkCreationDeps,
): Promise<Bookmark>;
```

The function normalizes the URL, checks a manual category, converts database unique error `23505` to the existing `409` shape, returns the mapped bookmark immediately, and starts categorization or metadata work with the existing warning behavior.

- [ ] **Step 3: Extract image creation orchestration**

Move the current durable image flow behind this signature:

```ts
export async function createImageBookmark(
  input: { userId: string; bytes: Buffer; filename: string },
  deps: ImageBookmarkCreationDeps,
): Promise<Bookmark>;
```

Keep `processImage`, deterministic paths, Storage cleanup after insert failure, analysis input, thumbnail signing fallback, and response mapping byte-for-byte equivalent to the existing route behavior.

- [ ] **Step 4: Delegate both existing POST routes to the services**

`POST /bookmarks` parses `createBookmarkRequestSchema` and calls `createLinkBookmark`. `POST /images` keeps Multer field parsing and calls `createImageBookmark` with `request.file.buffer` and `request.file.originalname`. Do not change their request or response contracts.

- [ ] **Step 5: Run regression tests**

Run:

```bash
bun run --cwd apps/api test -- images.test.ts bookmark-tags.test.ts categorize.test.ts
```

Expected: all selected tests pass with unchanged assertions.

- [ ] **Step 6: Commit the extraction**

```bash
git add apps/api/src/services/bookmark-creation.ts apps/api/src/services/image-bookmark-creation.ts apps/api/src/routes/bookmarks.ts apps/api/src/routes/images.ts
git commit -m "refactor: 북마크 생성 흐름 공용화"
```

### Task 2: Add the unified share route using TDD

**Files:**
- Create: `apps/api/src/routes/share.ts`
- Create: `apps/api/src/__tests__/share-routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/__tests__/app-auth-order.test.ts`

- [ ] **Step 1: Write failing HTTP boundary tests**

Create an injected test router and assert these exact calls:

```ts
expect(createLink).toHaveBeenCalledWith({
  userId,
  request: { url: "https://example.com/post", mode: "ai" },
});
expect(createImage).toHaveBeenCalledWith({
  userId,
  bytes: Buffer.from("image"),
  filename: "photo.heic",
});
```

Cover Bearer URL text, API Key JPEG/HEIC file, missing item, file plus text item, malformed URL, unexpected multipart field, and more than one file. Successful calls return `201 { bookmark }`; invalid/ambiguous forms return the common `400 VALIDATION_ERROR` format.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
bun run --cwd apps/api test -- share-routes.test.ts
```

Expected: FAIL because `createShareRouter` and `/api/share` do not exist.

- [ ] **Step 3: Implement the minimal router**

Use Multer memory storage with the existing image byte limit and accept only `item`:

```ts
router.use("/share", auth);
router.post("/share", upload.single("item"), async (request, response) => {
  const text = typeof request.body.item === "string" ? request.body.item : null;
  if (Boolean(request.file) === Boolean(text)) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "링크 또는 이미지 하나가 필요합니다",
    );
  }
  const bookmark = request.file
    ? await deps.createImage({
        userId: getUserId(request),
        bytes: request.file.buffer,
        filename: request.file.originalname,
      })
    : await deps.createLink({
        userId: getUserId(request),
        request: { url: z.url().parse(text), mode: "ai" },
      });
  response.status(201).json({ bookmark });
});
```

Map Multer limit/unexpected-field errors through the existing common error middleware conventions rather than returning Multer HTML/errors.

- [ ] **Step 4: Mount and rate-limit `/share`**

Add `shareRouter` after bookmark/image-compatible authentication routers and extend the allowlist:

```ts
path === "/share" ||
path === "/bookmarks" ||
path.startsWith("/bookmarks/") ||
path === "/images" ||
path === "/categories" ||
path.startsWith("/categories/")
```

Add a rate-limit regression request using `X-API-Key` against `/api/share` and assert the 61st request is `429 RATE_LIMITED`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
bun run --cwd apps/api test -- share-routes.test.ts app-auth-order.test.ts images.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit the endpoint**

```bash
git add apps/api/src/routes/share.ts apps/api/src/__tests__/share-routes.test.ts apps/api/src/app.ts apps/api/src/__tests__/app-auth-order.test.ts
git commit -m "feat: iOS 단축어 통합 공유 API 추가"
```

### Task 3: Document the one-shortcut setup

**Files:**
- Modify: `docs/03-api.md`
- Modify: `docs/shortcuts-guide.md`

- [ ] **Step 1: Add the API contract**

Document `POST /api/share` immediately after the separate creation endpoints with this request shape:

```text
Content-Type: multipart/form-data
X-API-Key: bm_...
item: URL text or one image file
```

State that URL items use AI mode, image items use the existing automatic image analysis, and existing endpoints remain supported.

- [ ] **Step 2: Replace the primary shortcut recipe**

Make `북마크 저장` the recommended recipe: share-sheet input types URL/Safari webpage/image, `각 항목 반복`, one form field `item=반복 항목`, no manually set Content-Type, and final success/failure notification. Keep separate recipes in a legacy/advanced subsection for compatibility.

- [ ] **Step 3: Check docs and commit**

Run:

```bash
rg -n "POST /api/share|item|북마크 저장" docs/03-api.md docs/shortcuts-guide.md
```

Expected: both documents describe the same endpoint, field name, and shortcut behavior.

```bash
git add docs/03-api.md docs/shortcuts-guide.md
git commit -m "docs: 통합 iOS 공유 단축어 안내 추가"
```

### Task 4: Full verification and progress record

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run the repository verification loop**

Run:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: all commands exit 0. Existing API seed-script info and known web dynamic-import/chunk warnings may remain informational only.

- [ ] **Step 2: Update progress**

Add the unified share API to the current state/checklist, record the exact test totals, and leave these manual iPhone checks explicit:

```text
Safari URL, JPEG, HEIC, multiple selected images, and mixed share input through one shortcut.
```

- [ ] **Step 3: Inspect scope and commit**

Run:

```bash
git diff --check
git status --short
```

Expected: only `PROGRESS.md` remains from this task; pre-existing `.env.example`, Docker Compose, and Caddy files remain untouched.

```bash
git add PROGRESS.md
git commit -m "docs: 통합 공유 API 검증 결과 기록"
```
