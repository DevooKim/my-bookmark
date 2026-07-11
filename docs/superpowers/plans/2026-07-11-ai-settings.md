# AI Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authenticated users to select an AI provider and securely store, replace, and delete each provider API key from Settings.

**Architecture:** Add one RLS-protected `ai_settings` row per user, encrypt provider keys with AES-256-GCM, and expose only configured flags through Bearer-only Express routes. Replace the boot-time environment provider singleton with a user-keyed provider cache invalidated by settings mutations, then add a TanStack Query settings form.

**Tech Stack:** TypeScript strict, Express 5, Supabase Postgres, Node crypto, zod, React 19, TanStack Query, Vitest, supertest.

---

### Task 1: Database and shared HTTP contracts

**Files:**
- Create: `supabase/migrations/0002_ai_settings.sql`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

- [ ] Write failing schema tests for an AI status containing `provider`, `enabled`, and three configured flags, plus `updateAiSettingsRequestSchema` accepting `{ provider, apiKey? }` and rejecting blank or 513-character keys.
- [ ] Run `pnpm --filter @my-bookmark/shared test`; expect schema assertions to fail because the contracts do not exist.
- [ ] Add `aiProviderNameSchema`, `aiProviderStatusSchema`, expanded `aiStatusResponseSchema`, and `updateAiSettingsRequestSchema`, exporting inferred `AiProviderName` and `UpdateAiSettingsRequest` types.
- [ ] Add `ai_settings` with a user PK, provider check, three nullable encrypted key columns, timestamps, update trigger, RLS, and owner policy.
- [ ] Run the shared tests and commit with `feat: add AI settings data contracts`.

### Task 2: Encryption configuration and primitive

**Files:**
- Create: `apps/api/src/lib/secret-crypto.ts`
- Create: `apps/api/src/__tests__/secret-crypto.test.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/__tests__/env.test.ts`

- [ ] Write failing tests asserting randomized `v1` AES-256-GCM round trips, tamper/wrong-key rejection, and environment rejection for missing or non-32-byte base64 `AI_SETTINGS_ENCRYPTION_KEY` outside test.
- [ ] Run the focused tests and verify failures.
- [ ] Implement `parseEncryptionKey(value)` and `createSecretCipher(key)` using 12-byte random IVs, auth tags, base64url components, and a `v1:<iv>:<tag>:<ciphertext>` payload.
- [ ] Replace old AI provider/key/model env fields with `AI_SETTINGS_ENCRYPTION_KEY`; keep it optional only in `NODE_ENV=test` so isolated tests can inject a key.
- [ ] Run focused tests and commit with `feat: encrypt stored AI credentials`.

### Task 3: User-scoped AI settings service and provider cache

**Files:**
- Replace: `apps/api/src/services/ai-provider.ts`
- Create: `apps/api/src/__tests__/ai-provider.test.ts`

- [ ] Write a fake `ai_settings` DB test covering no-row Gemini defaults, encrypted key upsert, provider-only changes retaining keys, deletion, strict `user_id` filters, and no secret fields in returned status.
- [ ] Write provider cache tests showing repeated lookup reuses the instance, settings mutation invalidates it, and an unconfigured selected provider returns `null`.
- [ ] Run the focused test and verify failure against the boot-time singleton.
- [ ] Implement an `AiSettingsService` with `getStatus(userId)`, `save(userId, input)`, `deleteKey(userId, provider)`, `getProvider(userId)`, and `invalidate(userId)`. Map providers to fixed DB columns and create SDK providers only after decrypting the selected key.
- [ ] Run focused tests and commit with `feat: add user-scoped AI provider settings`.

### Task 4: Bearer-only AI settings routes

**Files:**
- Modify: `apps/api/src/routes/ai.ts`
- Create: `apps/api/src/__tests__/ai-routes.test.ts`

- [ ] Build route tests with an injected fake settings service and bearer verifier: `GET /api/ai`, `PUT /api/ai`, `DELETE /api/ai/keys/:provider`, invalid provider/key 400s, and unauthenticated 401s. Assert responses never contain raw/encrypted keys.
- [ ] Run the route tests and verify failure.
- [ ] Export `createAiRouter(service, authMiddleware)` and mount the default router using the production settings service. Parse every body/parameter with shared zod schemas and return the status contract.
- [ ] Run route and auth-order tests and commit with `feat: expose AI settings API`.

### Task 5: Resolve providers per user during categorization

**Files:**
- Modify: `apps/api/src/routes/bookmarks.ts`
- Modify: `apps/api/src/__tests__/bookmark-security.test.ts`
- Modify: `apps/api/src/__tests__/categorize.test.ts`

- [ ] Add a failing route/service regression proving an AI bookmark resolves the provider with the authenticated user ID and that missing credentials still marks pending classification failed.
- [ ] Run the focused tests and verify failure because `getAiProvider()` is global and synchronous.
- [ ] Resolve `getAiProvider(userId)` inside each fire-and-forget task before calling `categorizeBookmark`, preserving immediate HTTP responses, metadata behavior, and terminal `.catch()` handling.
- [ ] Run API tests and commit with `feat: use per-user AI credentials for classification`.

### Task 6: Settings UI and API client

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/_authed/settings.tsx`
- Modify: `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] Add failing component/helper tests for selecting a provider, saving a replacement password value, clearing the field after success, configured/unconfigured labels, deleting a configured key, and mutation error feedback. Extend the API client mock with `updateAiSettings` and `deleteAiProviderKey`.
- [ ] Run `pnpm --filter @my-bookmark/web test -- -t "AI settings"`; expect failure.
- [ ] Add API client functions that parse shared request/response schemas for `PUT /api/ai` and `DELETE /api/ai/keys/:provider`.
- [ ] Replace the read-only AI section with an accessible select, password input (`maxLength=512`, no stored value), save button, three-provider status list, and delete buttons. Invalidate/set `['ai']`, clear secrets after success, disable pending controls, and use Korean sonner feedback.
- [ ] Run web tests and commit with `feat: manage AI provider keys in settings`.

### Task 7: Documentation, migration, and full verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/01-architecture.md`
- Modify: `docs/02-database.md`
- Modify: `docs/03-api.md`
- Modify: `docs/05-ai.md`
- Modify: `docs/07-ui.md`
- Modify: `docs/deploy.md`
- Modify: `PROGRESS.md`

- [ ] Remove runtime provider/model/API-key env documentation and add `AI_SETTINGS_ENCRYPTION_KEY`, generated with `openssl rand -base64 32`. Document migration-before-deploy and DB-only settings behavior.
- [ ] Update DB, API, AI flow, and settings UI specs to match implemented contracts; record the post-roadmap feature and security decision in `PROGRESS.md`.
- [ ] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; fix root causes until all pass.
- [ ] Run `git diff --check`, inspect secret-like output to ensure no real key was committed, and review every design requirement against code/tests/docs.
- [ ] Commit with `feat: complete runtime AI settings`.
