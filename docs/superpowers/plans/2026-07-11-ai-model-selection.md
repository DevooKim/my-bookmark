# AI Model Selection and Key Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Select one low-cost or balanced model across configured AI providers and validate each stored API key through the provider Models API.

**Architecture:** Keep a six-entry model catalog in shared code, persist the active provider/model pair in `ai_settings`, and pass the selected model into the cached provider. Extend provider implementations with a no-inference Models API connection check exposed by a Bearer-only endpoint and per-provider Settings buttons.

**Tech Stack:** TypeScript, zod, Supabase Postgres, Express 5, Gemini/Anthropic/OpenAI SDKs, React 19, TanStack Query, Vitest, supertest.

---

### Task 1: Shared model catalog and migration

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/__tests__/ai-settings.test.ts`
- Create: `supabase/migrations/0003_ai_model.sql`

- [x] Add failing tests for the six exact catalog entries, provider/model pair validation, required model in update requests, and connection-test response parsing.
- [x] Run shared tests and confirm the missing contracts fail.
- [x] Add `AI_MODEL_CATALOG`, model ID schema/refinement, expanded status/update schemas, and `{ provider, ok }` response schema/types.
- [x] Add and backfill `ai_settings.model`, then enforce not-null and the six valid provider/model pairs in SQL.
- [x] Run shared tests.

### Task 2: Provider Models API validation

**Files:**
- Modify: `packages/ai/src/types.ts`
- Modify: `packages/ai/src/providers.ts`
- Modify: `packages/ai/src/__tests__/provider.test.ts`

- [x] Extend SDK mocks and write failing tests that `validateConnection()` calls Gemini `models.list({ config: { pageSize: 1, abortSignal } })`, Anthropic `models.list({ limit: 1 }, { signal })`, and OpenAI `models.list({ signal })`.
- [x] Run provider tests and confirm the method is missing.
- [x] Add `validateConnection(): Promise<void>` to `AiProvider`; implement all three with `withTimeout(..., 10_000)` and no generation calls.
- [x] Run provider tests.

### Task 3: Model-aware settings service and API

**Files:**
- Modify: `apps/api/src/services/ai-provider.ts`
- Modify: `apps/api/src/routes/ai.ts`
- Modify: `apps/api/src/__tests__/ai-provider.test.ts`
- Modify: `apps/api/src/__tests__/ai-routes.test.ts`

- [x] Write failing service tests for provider-based default model, model persistence, selected model passed to `providerFactory`, keyless provider/model rejection, and connection success/failure without secret exposure.
- [x] Write failing route tests for required valid provider/model and `POST /api/ai/test/:provider` returning `{ ok: true/false }`.
- [x] Run focused API tests and verify expected failures.
- [x] Add `model` to DB row parsing/defaults/status, validate configured credentials before saving, pass model to provider creation, and implement uncached `testConnection(userId, provider)`.
- [x] Add the route using shared response parsing; map provider validation failures to `ok: false` while missing keys remain 400.
- [x] Run API tests and typecheck.

### Task 4: Grouped model selector and connection buttons

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/_authed/settings.tsx`
- Modify: `apps/web/src/routes/_authed/-settings.test.tsx`

- [x] Add failing UI tests for provider optgroups, disabled keyless-provider models, saving the chosen provider/model pair, and a configured provider connection button success/failure.
- [x] Run focused web tests and verify failures.
- [x] Add `testAiProviderConnection(provider)` to the API client.
- [x] Replace provider select with a grouped catalog model select, derive provider from model, disable keyless models, and add row-scoped connection test controls/toasts.
- [x] Run web tests and typecheck.

### Task 5: Documentation, migration, and verification

**Files:**
- Modify: `docs/02-database.md`
- Modify: `docs/03-api.md`
- Modify: `docs/05-ai.md`
- Modify: `docs/07-ui.md`
- Modify: `PROGRESS.md`

- [x] Document the catalog, persisted model, connection endpoint, Models API cost limitation, and UI behavior.
- [x] Apply `0003_ai_model.sql` with Supabase CLI and verify model column/check/RLS through read-only MCP inspection.
- [x] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` until clean.
- [x] Rebuild Docker, verify health, then use the browser to save a configured-provider model and run its connection test.
- [x] Mark this plan complete, update progress evidence, run `git diff --check`, and commit focused backend, web, and docs changes.
