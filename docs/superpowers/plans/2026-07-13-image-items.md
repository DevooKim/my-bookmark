# Image Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private image items that upload from iOS, web/PWA, and the OS share sheet, then use the existing OpenRouter preset to generate title, summary, tags, and category.

**Architecture:** Extend `bookmarks` with a `kind` discriminator and image metadata, while retaining the existing categories, reminders, AI state, search, and usage-event pipeline. Express owns multipart validation, image normalization, private Supabase Storage access, and signed URL creation; the browser only consumes the REST API. Image analysis uses the same strict structured output as links with a base64 image part in the OpenRouter request.

**Tech Stack:** Bun workspaces, TypeScript 7 strict, Express 5, multer, sharp, Supabase Postgres/Storage, OpenRouter Chat Completions, TanStack Start/Query, React 19, Vitest, Testing Library, PWA service worker.

---

## File map

- `supabase/migrations/20260713141607_image_items.sql`: table constraints, private bucket, search RPC and type-filter index.
- `packages/shared/src/index.ts`: discriminated bookmark response, kind query, nullable URL for reminders.
- `packages/shared/src/__tests__/image-items.test.ts`: contract regression tests.
- `packages/ai/src/types.ts`: discriminated link/image analysis input.
- `packages/ai/src/schema.ts`: link and image prompt builders.
- `packages/ai/src/providers.ts`: OpenRouter multipart message content.
- `packages/ai/src/__tests__/providers.test.ts`: request-body regression tests.
- `apps/api/src/services/image-processing.ts`: decode, metadata, analysis JPEG and WebP thumbnail.
- `apps/api/src/services/image-storage.ts`: deterministic private object paths, upload, cleanup, signed URLs.
- `apps/api/src/services/categorize.ts`: load link or image input and reuse conditional result application.
- `apps/api/src/routes/images.ts`: multipart image creation endpoint.
- `apps/api/src/routes/bookmarks.ts`: kind filter, signed media URLs, image delete and reanalysis.
- `apps/api/src/lib/db-mappers.ts`: map discriminated DB rows.
- `apps/api/src/app.ts`: image router mount and API-key rate-limit scope.
- `apps/api/src/services/reminder-cron.ts`: internal image-detail reminder URL.
- `apps/web/src/lib/api-client.ts`: kind filtering, multipart upload and item detail.
- `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`: link/image input and upload queue.
- `apps/web/src/routes/_authed/index.tsx`: type filter and image card.
- `apps/web/src/routes/_authed/images.$id.tsx`: internal image detail.
- `apps/web/src/lib/share-target.ts`: staged share-file persistence and consumption.
- `apps/web/src/routes/_authed/share-target.tsx`: authenticated share upload screen.
- `apps/web/src/sw/sw.ts`: share-target POST interception without private-image caching.
- `apps/web/public/manifest.webmanifest`: file share target declaration.
- `docs/shortcuts-guide.md`: image shortcut instructions.
- `docs/03-api.md`, `docs/05-ai.md`, `PROGRESS.md`: final contract and verification record.

### Task 1: Database and shared contracts

**Files:**
- Create: `supabase/migrations/20260713141607_image_items.sql` via `bunx supabase migration new image_items`
- Create: `packages/shared/src/__tests__/image-items.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing shared-schema tests**

Cover a link item, a complete image item, rejection of an image with a URL, rejection of a link without a URL, `kind=image` list parsing, and nullable reminder URLs. Use fixed UUIDs and ISO timestamps so the assertions are deterministic.

```ts
expect(bookmarkSchema.parse({ ...base, kind: "link", url: "https://example.com" }).kind).toBe("link");
expect(bookmarkSchema.parse({
  ...base,
  kind: "image",
  url: null,
  image: {
    thumbnailUrl: "https://signed.example/thumb",
    originalUrl: null,
    mimeType: "image/heic",
    fileSize: 1024,
    width: 1200,
    height: 900,
    filename: "photo.heic",
  },
}).kind).toBe("image");
expect(bookmarkListQuerySchema.parse({ kind: "image" }).kind).toBe("image");
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `bun run --cwd packages/shared test -- image-items.test.ts`

Expected: failure because `kind`, `image`, and the list filter are absent.

- [ ] **Step 3: Implement discriminated schemas and types**

Define a common schema and a discriminated union. Keep response URL fields signed and transient; never expose Storage paths.

```ts
export const bookmarkKindSchema = z.enum(["link", "image"]);
export const imageMetadataSchema = z.object({
  thumbnailUrl: z.url().nullable(),
  originalUrl: z.url().nullable(),
  mimeType: z.string().startsWith("image/"),
  fileSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  filename: z.string().min(1),
});

export const bookmarkSchema = z.discriminatedUnion("kind", [
  bookmarkCommonSchema.extend({ kind: z.literal("link"), url: z.url(), image: z.null() }),
  bookmarkCommonSchema.extend({ kind: z.literal("image"), url: z.null(), image: imageMetadataSchema }),
]);
```

Extend `bookmarkListQuerySchema` with `kind: bookmarkKindSchema.optional()`. Change the reminder bookmark pick to preserve `kind`, nullable `url`, and title.

- [ ] **Step 4: Create the migration with the installed CLI**

Run: `bunx supabase migration new image_items`

In the generated file, drop the old `bookmarks_url_check` and `bookmarks_user_id_url_key`, make URL nullable, add image columns, then add named constraints equivalent to:

```sql
alter table public.bookmarks
  add column kind text not null default 'link',
  add column image_original_path text,
  add column image_thumbnail_path text,
  add column image_mime_type text,
  add column image_file_size bigint,
  add column image_width integer,
  add column image_height integer,
  add column image_filename text;

alter table public.bookmarks add constraint bookmarks_kind_check
  check (kind in ('link', 'image'));

alter table public.bookmarks add constraint bookmarks_content_check check (
  (kind = 'link' and url ~ '^https?://' and image_original_path is null and image_thumbnail_path is null)
  or
  (kind = 'image' and url is null and image_original_path is not null
   and image_thumbnail_path is not null and image_mime_type like 'image/%'
   and image_file_size > 0 and image_width > 0 and image_height > 0
   and char_length(image_filename) > 0)
);

create unique index bookmarks_user_url_unique
  on public.bookmarks (user_id, url) where kind = 'link';
create index bookmarks_user_kind_created_idx
  on public.bookmarks (user_id, kind, created_at desc, id desc);
```

Insert or update `storage.buckets` for a private `bookmark-images` bucket with a 20MB file limit and the accepted MIME allowlist. Replace `search_bookmarks` with a signature that adds `p_kind text default null`, applies `(p_kind is null or b.kind = p_kind)`, and treats `b.url` as nullable. Revoke the old function signature before granting only the new signature to `service_role`.

- [ ] **Step 5: Run contract tests and SQL lint checks**

Run: `bun run --cwd packages/shared test -- image-items.test.ts && bun run --cwd packages/shared typecheck && bun run --cwd packages/shared lint`

Expected: all pass.

- [ ] **Step 6: Commit the contract slice**

```bash
git add packages/shared supabase/migrations
git commit -m "feat: 이미지 항목 데이터 계약 추가"
```

### Task 2: Image processing and private Storage services

**Files:**
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `bun.lock`
- Create: `apps/api/src/services/image-processing.ts`
- Create: `apps/api/src/services/image-storage.ts`
- Create: `apps/api/src/__tests__/image-processing.test.ts`
- Create: `apps/api/src/__tests__/image-storage.test.ts`

- [ ] **Step 1: Add failing image-processing tests**

Generate tiny PNG and JPEG fixtures with `sharp` inside tests. Assert MIME detection from decoded content, dimensions, WebP thumbnail bounds, JPEG analysis output, orientation normalization, invalid bytes rejection, and the exported 20MB limit.

```ts
const source = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
const result = await processImage(source, "photo.png");
expect(result).toMatchObject({ mimeType: "image/png", width: 1200, height: 600 });
expect((await sharp(result.thumbnail).metadata()).width).toBeLessThanOrEqual(640);
expect((await sharp(result.analysisImage).metadata()).format).toBe("jpeg");
```

- [ ] **Step 2: Add dependencies and confirm RED**

Run: `bun add --cwd apps/api multer sharp && bun add --cwd apps/api -d @types/multer`

Add `sharp` to the root `trustedDependencies`. Run the focused test; expect missing service exports.

- [ ] **Step 3: Implement focused processing functions**

Export the concrete boundary:

```ts
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export interface ProcessedImage {
  original: Buffer;
  thumbnail: Buffer;
  analysisImage: Buffer;
  extension: string;
  mimeType: string;
  width: number;
  height: number;
  filename: string;
}
export async function processImage(bytes: Buffer, filename: string): Promise<ProcessedImage>;
```

Use `sharp(bytes, { animated: false, failOn: "error", limitInputPixels: 64_000_000 })`, `rotate()` for orientation, WebP thumbnail with `fit: "inside"` and a 640px maximum, and JPEG analysis with a 2048px maximum. Map actual decoded formats to the allowed MIME types and reject SVG/PDF/arbitrary bytes.

- [ ] **Step 4: Write failing Storage service tests**

Use a fake bucket implementing `upload`, `remove`, and `createSignedUrl`. Assert deterministic user/item paths, compensating cleanup when the thumbnail upload fails, both-path removal, and separate thumbnail/original signed URL generation.

- [ ] **Step 5: Implement Storage service**

```ts
export interface StoredImagePaths { originalPath: string; thumbnailPath: string }
export async function storeImage(input: {
  storage: StorageBucket;
  userId: string;
  bookmarkId: string;
  image: ProcessedImage;
}): Promise<StoredImagePaths>;
export async function removeImage(storage: StorageBucket, paths: StoredImagePaths): Promise<void>;
export async function signImage(storage: StorageBucket, path: string, expiresIn?: number): Promise<string>;
```

Use `upsert: false`, explicit content types, and 600-second signed URLs. Do not log bytes, object URLs, or signed URLs.

- [ ] **Step 6: Run focused tests and commit**

Run: `bun run --cwd apps/api test -- image-processing.test.ts image-storage.test.ts && bun run --cwd apps/api typecheck && bun run --cwd apps/api lint`

Commit:

```bash
git add package.json apps/api/package.json bun.lock apps/api/src/services apps/api/src/__tests__
git commit -m "feat: 이미지 처리와 비공개 저장소 서비스 추가"
```

### Task 3: Multimodal OpenRouter analysis

**Files:**
- Modify: `packages/ai/src/types.ts`
- Modify: `packages/ai/src/schema.ts`
- Modify: `packages/ai/src/providers.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/src/__tests__/providers.test.ts`
- Modify: `packages/ai/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing multimodal provider tests**

Keep the existing link request assertion and add an image case that checks text comes first, the second part is an `image_url` data URL, the preset remains unchanged, and strict JSON schema remains enabled.

```ts
await provider.categorize({
  kind: "image",
  image: { mimeType: "image/jpeg", base64: "AQID" },
  existingCategories: [],
});
expect(body.messages[1].content).toEqual([
  { type: "text", text: expect.any(String) },
  { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
]);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `bun run --cwd packages/ai test -- providers.test.ts schema.test.ts`

Expected: image input is not assignable and provider only creates string content.

- [ ] **Step 3: Implement discriminated analysis input**

```ts
export type CategorizeInput =
  | { kind: "link"; url: string; title?: string; description?: string; siteName?: string; existingCategories: CategoryInput[] }
  | { kind: "image"; image: { mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }; existingCategories: CategoryInput[] };
```

Make `userPrompt` switch on `kind`; the image prompt describes the requested title, summary, tags, and category without persisting OCR. Build the OpenRouter message as a string for links and an ordered content array for images. Keep `provider.require_parameters`, timeout, response parsing, model and BYOK usage parsing unchanged.

- [ ] **Step 4: Run the AI package suite and commit**

Run: `bun run --cwd packages/ai test && bun run --cwd packages/ai typecheck && bun run --cwd packages/ai lint`

Commit:

```bash
git add packages/ai
git commit -m "feat: OpenRouter 이미지 분석 입력 지원"
```

### Task 4: Image upload API and categorization pipeline

**Files:**
- Create: `apps/api/src/routes/images.ts`
- Create: `apps/api/src/__tests__/images.test.ts`
- Modify: `apps/api/src/services/categorize.ts`
- Modify: `apps/api/src/__tests__/categorize.test.ts`
- Modify: `apps/api/src/lib/db-mappers.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/middleware/error.ts`

- [ ] **Step 1: Write failing route tests with injected dependencies**

Cover missing file, oversize upload, corrupt image, Bearer and API Key acceptance, API Key rate-limit path inclusion, successful `201 pending`, original cleanup after thumbnail failure, full cleanup after DB failure, and background analysis invocation.

Construct `createImagesRouter({ db, storage, processImage, categorize })` so tests do not need live Supabase or OpenRouter.

- [ ] **Step 2: Confirm route tests fail**

Run: `bun run --cwd apps/api test -- images.test.ts`

Expected: route module does not exist.

- [ ] **Step 3: Implement multipart upload route**

Use `multer.memoryStorage()` with one `image` field and `limits.fileSize = MAX_IMAGE_BYTES`. Translate multer size errors to the common error envelope with 413. Map unsupported/corrupt processing errors to 415/400 without weakening global zod error handling.

Insert a complete image row only after both objects exist:

```ts
const insert = {
  id: bookmarkId,
  user_id: userId,
  kind: "image",
  url: null,
  image_original_path: paths.originalPath,
  image_thumbnail_path: paths.thumbnailPath,
  image_mime_type: image.mimeType,
  image_file_size: image.original.byteLength,
  image_width: image.width,
  image_height: image.height,
  image_filename: image.filename,
  ai_status: "pending",
};
```

After returning the mapped row with a signed thumbnail, start `categorizeBookmarkForUser` with the in-memory normalized analysis image. The fallback/retry path must be able to download and normalize the stored original later.

- [ ] **Step 4: Extend categorization to load either content kind**

Add image columns to `BookmarkRow`. For links keep `fetchMetadata`; for images load the normalized image through an injected `imageLoader`. Pass `kind: "link"` or `kind: "image"` to `provider.categorize`. Reuse usage recording and `applyCategorizeResult` unchanged.

- [ ] **Step 5: Map image rows and signed media**

Extend `mapBookmark(row, media?)` so it returns the shared discriminated shape. Reject impossible DB states via zod rather than assertions. Mount `imagesRouter`, add `/images` to the API-key rate-limit allowlist, and keep secret headers redacted.

- [ ] **Step 6: Run API tests and commit**

Run: `bun run --cwd apps/api test -- images.test.ts categorize.test.ts bookmark-security.test.ts && bun run --cwd apps/api typecheck && bun run --cwd apps/api lint`

Commit:

```bash
git add apps/api
git commit -m "feat: 이미지 업로드와 AI 분석 API 추가"
```

### Task 5: Existing bookmark APIs, search, delete and reminders

**Files:**
- Modify: `apps/api/src/routes/bookmarks.ts`
- Modify: `apps/api/src/routes/reminders.ts`
- Modify: `apps/api/src/services/reminder-cron.ts`
- Modify: `apps/api/src/__tests__/bookmarks.test.ts`
- Modify: `apps/api/src/__tests__/reminder-cron.test.ts`

- [ ] **Step 1: Add failing integration regressions**

Assert list RPC receives `p_kind`, list/detail sign only owned image paths, link creation still produces `kind=link`, image PATCH cannot set URL, image DELETE removes both objects before deleting the row, repeated delete tolerates missing objects, and reminder payload URLs are `WEB_ORIGIN/images/{id}` for images but remain external for links.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `bun run --cwd apps/api test -- bookmarks.test.ts reminder-cron.test.ts`

- [ ] **Step 3: Implement kind-aware bookmark routes**

Pass `p_kind: query.kind ?? null` to `search_bookmarks`. Batch-sign thumbnail paths for returned images and sign original only in detail. Do not sign links. Reject URL changes for image rows. For deletion, load the owned row first, remove image objects when needed, then delete with both `user_id` and `id` filters.

- [ ] **Step 4: Make reminders kind-aware**

Select `id,kind,url,title` in reminder joins. Build the payload using:

```ts
const targetUrl = bookmark.kind === "image"
  ? `${appEnv.WEB_ORIGIN}/images/${bookmark.id}`
  : bookmark.url;
```

Use `이미지` as the fallback label when an image has no generated title. Preserve the existing claim-before-send behavior.

- [ ] **Step 5: Run the full API suite and commit**

Run: `bun run --cwd apps/api test && bun run --cwd apps/api typecheck && bun run --cwd apps/api lint`

Commit:

```bash
git add apps/api
git commit -m "feat: 통합 항목 검색과 이미지 리마인더 연결"
```

### Task 6: Web upload queue and type filtering

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/routes/_authed/-components/image-upload.tsx`
- Create: `apps/web/src/routes/_authed/-components/image-upload.test.tsx`
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] **Step 1: Write failing API-client and upload UI tests**

Assert `listBookmarks({ kind: "image" })` emits the query parameter, `createImage(file)` sends FormData without forcing JSON Content-Type, multiple selected files produce independent queue items, drop and paste use the same queue, successful files remain successful when another fails, and closing is disabled only while an active request is in flight.

- [ ] **Step 2: Confirm focused tests fail**

Run: `bun run --cwd apps/web test -- image-upload.test.tsx -index.test.tsx`

- [ ] **Step 3: Add multipart API client**

```ts
export async function createImage(file: File): Promise<Bookmark> {
  const form = new FormData();
  form.set("image", file, file.name);
  const response = await apiFetch("/api/images", { method: "POST", body: form });
  return parseJsonResponse(response, (json) => bookmarkSchema.parse((json as { bookmark?: unknown }).bookmark));
}
```

Update `apiFetch` so it sets `application/json` only for string bodies, never for FormData.

- [ ] **Step 4: Implement the isolated upload queue**

`ImageUpload` owns `UploadItem[]` with `queued | uploading | success | failed`, previews via object URLs, cleans them on removal/unmount, sends one request per image with bounded concurrency of two, and exposes completion to the dialog. Use a visually labelled drop zone and hidden `multiple` file input; only accept `image/*` from selection, drop, or clipboard.

- [ ] **Step 5: Add link/image mode to the dialog**

Keep existing link form and remembered link categorization mode intact. In image mode render only `ImageUpload`, explain automatic AI analysis, invalidate `bookmarks` and `categories` after each success, and show per-file error messages without closing early.

- [ ] **Step 6: Run focused web tests and commit**

Run: `bun run --cwd apps/web test -- image-upload.test.tsx -index.test.tsx && bun run --cwd apps/web typecheck && bun run --cwd apps/web lint`

Commit:

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/routes/_authed
git commit -m "feat: 웹 이미지 업로드 큐 추가"
```

### Task 7: Unified image cards and detail page

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`
- Create: `apps/web/src/routes/_authed/images.$id.tsx`
- Create: `apps/web/src/routes/_authed/-image-detail.test.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing home and detail tests**

Cover `전체/링크/이미지` filter query keys, image cards without `new URL(null)`, internal detail navigation, thumbnail rendering, link cards preserving external targets, detail original rendering, download, edit, retry and delete actions, and a graceful expired/missing media state.

- [ ] **Step 2: Confirm RED**

Run: `bun run --cwd apps/web test -- -index.test.tsx -image-detail.test.tsx`

- [ ] **Step 3: Implement kind filter and discriminated card rendering**

Add `kind` to state, query key and `listBookmarks` params. Render a compact three-choice segmented filter above category chips. Split card content into small `LinkBookmarkContent` and `ImageBookmarkContent` components so URL construction is only reachable in the link branch. Image card links to `/images/{id}` and uses `bookmark.image.thumbnailUrl` with an accessible fallback.

- [ ] **Step 4: Implement authenticated image detail route**

Fetch `GET /api/bookmarks/:id`, reject link items with a not-found state, render the signed original with title, description, tags, category and AI status, and reuse existing update/reanalysis/delete clients. Download through the signed original URL with `download={bookmark.image.filename}`. Refetch detail when the image load reports an expired signed URL.

- [ ] **Step 5: Run web suite and commit**

Run: `bun run --cwd apps/web test && bun run --cwd apps/web typecheck && bun run --cwd apps/web lint`

Commit:

```bash
git add apps/web
git commit -m "feat: 이미지 필터 카드와 상세 화면 추가"
```

### Task 8: iOS shortcut documentation and PWA share target

**Files:**
- Modify: `docs/shortcuts-guide.md`
- Modify: `apps/web/public/manifest.webmanifest`
- Create: `apps/web/src/lib/share-target.ts`
- Create: `apps/web/src/lib/share-target.test.ts`
- Create: `apps/web/src/routes/_authed/share-target.tsx`
- Modify: `apps/web/src/sw/sw.ts`
- Modify: `apps/web/src/sw/sw.test.ts`

- [ ] **Step 1: Write failing share-target tests**

Assert only a POST to `/share-target` with an image file is intercepted, staged records contain file/name/type and a generated ID, the response redirects to `/_authed/share-target?id=...`, successful consumption removes the staged file, and ordinary POST/API requests remain network-only.

- [ ] **Step 2: Confirm RED**

Run: `bun run --cwd apps/web test -- share-target.test.ts sw.test.ts`

- [ ] **Step 3: Implement IndexedDB staging helpers and share route**

Expose `stageSharedImages`, `loadSharedImages`, and `deleteSharedImages`. The route loads the staged batch after auth, passes files through the same upload queue contract, deletes the record after all files settle or the user cancels, and shows a recoverable message when the record is absent.

- [ ] **Step 4: Add manifest and service-worker share handling**

Add:

```json
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text", "url": "url", "files": [{ "name": "images", "accept": ["image/*"] }] }
}
```

In the service worker, handle this path before `classifyRequest`, stage received files, and return a 303 redirect. Do not add Storage or signed image URLs to either cache.

- [ ] **Step 5: Update the iOS shortcut guide**

Document: receive Images from the share sheet, repeat each item, `Get Contents of URL` with POST multipart form field `image`, `X-API-Key`, success/failure counting, and JPEG/HEIC verification. Include the exact `/api/images` endpoint and warn that the key is shown once and must not be placed in shared screenshots.

- [ ] **Step 6: Run PWA tests/build and commit**

Run: `bun run --cwd apps/web test -- share-target.test.ts sw.test.ts && bun run --cwd apps/web build`

Commit:

```bash
git add apps/web docs/shortcuts-guide.md
git commit -m "feat: 이미지 공유 대상과 단축어 등록 추가"
```

### Task 9: Documentation, migration verification and full regression

**Files:**
- Modify: `docs/03-api.md`
- Modify: `docs/05-ai.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update source-of-truth documentation**

Add the multipart endpoint, kind filter, signed media fields, upload errors, OpenRouter vision/preset requirement, private Storage policy, accepted formats, and 20MB limit. Record that OCR text is intentionally not persisted.

- [ ] **Step 2: Validate the local migration and advisors**

Run the installed CLI help first if flags differ. Then run the repository-supported local migration validation or linked-project dry-run, followed by `supabase db advisors` when available. Do not push the migration to the remote project without explicit user confirmation; record remote push as pending in `PROGRESS.md`.

- [ ] **Step 3: Run the full verification loop**

Run:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: every workspace passes with no skipped failures.

- [ ] **Step 4: Run focused runtime checks**

Start API and web with valid local env, check `/api/health`, upload one generated JPEG through the API, verify the returned item is pending/done, confirm unsigned Storage access is denied, and inspect the 375px home/detail UI. If live Supabase/OpenRouter credentials are unavailable, record those exact manual checks as pending rather than faking success.

- [ ] **Step 5: Update progress and commit**

Record completed automated checks, actual manual evidence, design deviations, OpenRouter preset vision requirement, and pending remote migration/iOS device checks.

```bash
git add docs/03-api.md docs/05-ai.md PROGRESS.md
git commit -m "docs: 이미지 분석 기능과 검증 결과 반영"
```

- [ ] **Step 6: Final code review**

Review the complete diff against `docs/superpowers/specs/2026-07-13-image-items-design.md`, run `git diff --check`, ensure no secrets or signed URLs were logged, and verify `git status --short` contains only intentional changes.
