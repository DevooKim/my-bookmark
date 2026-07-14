# Image Source Links and Upload UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add verified SNS/GitHub source links to image metadata, render real local HEIC previews, and close the add dialog after every selected image uploads successfully.

**Architecture:** Extend the strict AI response with one nullable source candidate, but keep URL authority in Express: a focused source-link builder validates confidence, platform, HTTPS hosts, handles, and GitHub repositories before returning one metadata entry. Keep HEIC decoding entirely local and lazy in a small web helper that derives a preview blob while preserving the original upload `File`. Upgrade the upload completion callback to return terminal counts so the add dialog closes only after complete success and retains partial failures for retry.

**Tech Stack:** TypeScript 7, Zod, OpenRouter strict JSON Schema, Express 5, React 19, `heic-decode`, Canvas API, Vitest, Testing Library, Bun workspaces.

---

## File map

- `packages/ai/src/types.ts`: `SourcePlatform` and nullable `SourceCandidate` result contract.
- `packages/ai/src/schema.ts`: zod, strict JSON Schema, and direct-evidence prompt rules.
- `packages/ai/src/__tests__/provider.test.ts`: source parsing and prompt/strict-schema regressions.
- `apps/api/src/services/source-link.ts`: platform allowlists, handle/repository validation, and safe metadata entry construction.
- `apps/api/src/__tests__/source-link.test.ts`: URL policy boundary tests independent of database mocks.
- `apps/api/src/services/categorize.ts`: image-only source entry merge in the existing pending update.
- `apps/api/src/__tests__/categorize.test.ts`: integration with current metadata and link/image distinction.
- `apps/web/src/routes/_authed/-components/heic-preview.ts`: lazy HEIC decode and bounded JPEG preview blob creation.
- `apps/web/src/routes/_authed/-components/heic-preview.test.ts`: detection, canvas scaling, and failure boundaries.
- `apps/web/src/routes/_authed/-components/image-upload.tsx`: async preview state, object URL cleanup, and completion summary.
- `apps/web/src/routes/_authed/-components/image-upload.test.tsx`: HEIC preview/original upload and completion summary tests.
- `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`: all-success toast/invalidation/close behavior.
- `apps/web/src/routes/_authed/-index.test.tsx`: dialog close versus partial failure regression.
- `apps/web/package.json`, `bun.lock`: explicit lazy HEIC decoder dependency.
- `docs/05-ai.md`, `PROGRESS.md`: final contract, policy, verification, and remaining live checks.

### Task 1: Structured AI source candidate

- [x] **Step 1: Add failing provider tests**

Add a valid GitHub candidate, a valid Instagram candidate, `source: null`, and malformed platform/confidence cases to `packages/ai/src/__tests__/provider.test.ts`. Assert `jsonSchema.required` contains `source`, all five source properties are required, and `systemPrompt()` says handles, post identifiers, and repositories must be directly visible rather than inferred.

- [x] **Step 2: Verify RED**

Run: `bun run --cwd packages/ai test -- src/__tests__/provider.test.ts`

Expected: FAIL because `AnalyzeResult.source` and the strict source schema do not exist.

- [x] **Step 3: Implement the source contract**

Add these exact types to `packages/ai/src/types.ts` and mirror them in zod and strict JSON Schema:

```ts
export const sourcePlatforms = [
  "youtube",
  "instagram",
  "threads",
  "x",
  "tiktok",
  "github",
] as const;
export type SourcePlatform = (typeof sourcePlatforms)[number];

export interface SourceCandidate {
  platform: SourcePlatform;
  handle: string | null;
  postUrl: string | null;
  repository: string | null;
  confidence: number;
}
```

Add `source?: SourceCandidate | null` to `AnalyzeResult`. In the strict JSON Schema make `source` required with `type: ["object", "null"]`, require `platform`, `handle`, `postUrl`, `repository`, and `confidence`, and set `additionalProperties: false`. Extend the prompt with direct-evidence and no-inference rules.

- [x] **Step 4: Verify GREEN**

Run: `bun run --cwd packages/ai test -- src/__tests__/provider.test.ts`

Expected: all provider tests pass.

### Task 2: Safe server-owned source URLs

- [x] **Step 1: Write failing source-link policy tests**

Create `apps/api/src/__tests__/source-link.test.ts` around this public API:

```ts
buildSourceMetadataEntry(
  candidate: SourceCandidate | null | undefined,
): { key: string; value: string } | null;
```

Cover confidence `0.85`/`0.849`, HTTPS-only post URLs, exact platform host matching, a malicious suffix such as `github.com.evil.test`, post URL priority, platform profile fallback, leading `@` removal, invalid platform handles, GitHub `owner/repository` priority, and invalid GitHub paths. Include expected URLs for all six platforms.

- [x] **Step 2: Verify RED**

Run: `bun run --cwd apps/api test -- src/__tests__/source-link.test.ts`

Expected: FAIL because `services/source-link.ts` does not exist.

- [x] **Step 3: Implement the focused policy module**

Create `apps/api/src/services/source-link.ts` with a platform policy record containing metadata label, exact hosts, profile URL builder, and handle validator. Parse post URLs with `new URL`, require `https:`, empty credentials, exact allowlisted hostname, and a non-root path or YouTube watch query. Validate GitHub repository as exactly two non-empty path segments and construct `https://github.com/{owner}/{repository}` only after owner/repository validation. Return `null` for any uncertain or invalid candidate.

- [x] **Step 4: Verify GREEN**

Run: `bun run --cwd apps/api test -- src/__tests__/source-link.test.ts`

Expected: all policy tests pass.

### Task 3: Merge source links during image analysis

- [x] **Step 1: Add failing categorize integration tests**

In `apps/api/src/__tests__/categorize.test.ts`, prove that a confident image GitHub source adds `GitHub` while preserving `예약메모`, a link bookmark with the same source does not add it, an invalid source leaves other AI fields successful, and a place plus source candidate preserves both generated metadata entries.

- [x] **Step 2: Verify RED**

Run: `bun run --cwd apps/api test -- src/__tests__/categorize.test.ts`

Expected: FAIL because categorization only merges the existing Naver Map entry.

- [x] **Step 3: Implement sequential safe metadata merging**

Pass bookmark kind into `applyCategorizeResult`. Start from `currentMetadata`, merge the existing place entry through `bookmarkMetadataSchema.safeParse`, then for image bookmarks call `buildSourceMetadataEntry(result.source)` and merge that entry through the same shared schema. Preserve earlier successful entries if a later entry would exceed metadata limits. Omit the metadata update entirely when no generated entry was accepted.

- [x] **Step 4: Verify GREEN**

Run: `bun run --cwd apps/api test -- src/__tests__/source-link.test.ts src/__tests__/categorize.test.ts`

Expected: all source and categorize tests pass.

### Task 4: Lazy local HEIC preview

- [x] **Step 1: Add explicit web dependencies**

Add `heic-decode: ^2.1.0` to `apps/web` dependencies and `@types/heic-decode: ^2.0.0` to its devDependencies, then run `bun install` so `bun.lock` records the web workspace dependency without changing the resolved versions.

- [x] **Step 2: Write failing helper tests**

Create `apps/web/src/routes/_authed/-components/heic-preview.test.ts` for:

```ts
isHeicFile(file: File): boolean;
createHeicPreviewBlob(
  file: File,
  dependencies?: {
    decode: (input: { buffer: Uint8Array }) => Promise<DecodedImage>;
    createCanvas: () => HTMLCanvasElement;
  },
): Promise<Blob>;
```

Assert MIME and extension detection, a maximum dimension of 320, JPEG output, rejection when a 2D context or blob is unavailable, and that the original `File` is never replaced.

- [x] **Step 3: Verify RED**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-components/heic-preview.test.ts`

Expected: FAIL because the helper does not exist.

- [x] **Step 4: Implement lazy decoding and bounded canvas conversion**

Implement `createHeicPreviewBlob` so its default decoder is loaded with `await import("heic-decode")`, receives `new Uint8Array(await file.arrayBuffer())`, draws decoded RGBA to a source canvas, scales into a target canvas with the longest edge at most 320, and resolves `target.toBlob(..., "image/jpeg", 0.82)`. Keep dependency injection only for deterministic unit tests.

- [x] **Step 5: Verify GREEN**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-components/heic-preview.test.ts`

Expected: all helper tests pass.

### Task 5: Upload preview lifecycle and completion summary

- [x] **Step 1: Add failing `ImageUpload` tests**

Mock `createHeicPreviewBlob` in `image-upload.test.tsx`. Assert a HEIC row begins in preview-loading state, replaces it with a derived object URL, uploads the original HEIC `File`, shows a stable `HEIC` placeholder on decode failure, and revokes both ordinary and derived URLs. Add `onAllSettled` assertions for `{ successCount, failureCount }`, partial failure, and retry completion.

- [x] **Step 2: Verify RED**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-components/image-upload.test.tsx`

Expected: FAIL because HEIC is still rendered from its raw object URL and the completion callback has no summary.

- [x] **Step 3: Implement preview and terminal-state lifecycle**

Extend each upload item with `previewStatus: "loading" | "ready" | "failed"` and `previewUrl: string | null`. Ordinary files receive their object URL synchronously. HEIC files start without a URL, call `createHeicPreviewBlob`, then receive a derived URL only if the item still exists. Render loading text or the `HEIC` placeholder instead of a broken image. Track all created URLs and revoke them on removal/unmount.

Change `onAllSettled` to `(summary: UploadSummary) => void`. In the busy effect, invoke it only on a `true -> false` transition with no remaining selected/queued/uploading items, calculate counts from current item states, and always assign `wasBusy.current = busy` after the transition check.

- [x] **Step 4: Verify GREEN**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-components/image-upload.test.tsx`

Expected: all upload tests pass.

### Task 6: Close the add dialog only after complete success

- [x] **Step 1: Add failing dialog tests**

In `apps/web/src/routes/_authed/-index.test.tsx`, open the image tab and assert `onClose` behavior through `BookmarkDialog`: all-success summary closes once, `{ successCount: 1, failureCount: 1 }` stays open, and a later all-success retry closes. Assert success toast and bookmark/category invalidation happen once at the closing transition.

- [x] **Step 2: Verify RED**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx`

Expected: FAIL because `BookmarkDialog` does not pass `onAllSettled`.

- [x] **Step 3: Implement dialog completion behavior**

Pass a no-op `onUploaded` and an `onAllSettled` handler from `BookmarkDialog`. When the summary has at least one success and zero failures, show one success toast, invalidate bookmark/category queries once, and call `onClose`. On partial failure do nothing so retry controls remain mounted. Keep `share-target.tsx` invalidating per successful item, accept the summary argument without automatic navigation, and preserve its manual `완료` action.

- [x] **Step 4: Verify GREEN**

Run: `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx src/routes/_authed/-components/image-upload.test.tsx src/routes/_authed/-share-target.test.tsx`

Expected: all dialog, upload, and share-target tests pass.

### Task 7: Documentation, verification, and commits

- [x] **Step 1: Update source-of-truth docs**

Update `docs/05-ai.md` with the nullable source contract, image-only policy, confidence threshold, allowlisted server URL construction, and six metadata keys. Update the upload section in the relevant image design/spec if implementation constraints differ from this approved design.

- [x] **Step 2: Run focused verification**

Run:

```bash
bun run --cwd packages/ai test
bun run --cwd apps/api test -- src/__tests__/source-link.test.ts src/__tests__/categorize.test.ts
bun run --cwd apps/web test -- src/routes/_authed/-components/heic-preview.test.ts src/routes/_authed/-components/image-upload.test.tsx src/routes/_authed/-index.test.tsx
```

Expected: all focused suites pass.

- [x] **Step 3: Run full verification**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`

Expected: every command exits 0. Confirm the production web output places `heic-decode`/`libheif` in a lazy chunk rather than the initial index chunk.

- [x] **Step 4: Update `PROGRESS.md`**

Record the six supported source platforms, server-validation policy, HEIC root cause/fix, modal close rule, test totals, build result, and remaining live-image/browser checks.

- [x] **Step 5: Commit coherent implementation**

Stage only files from this plan and create Korean conventional commits whose purposes are clear from the previous commit, ending with a clean worktree.
