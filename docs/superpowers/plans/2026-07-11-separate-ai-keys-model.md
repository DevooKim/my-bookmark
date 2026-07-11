# Separate AI Keys and Model Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Manage API keys independently per provider and select an active model only from providers with stored keys.

**Architecture:** Split the combined settings mutation into provider-key and active-model endpoints/service methods. Render three independent credential cards followed by a filtered model selector with its own save action.

**Tech Stack:** TypeScript, zod, Express 5, React 19, TanStack Query, Vitest, Testing Library.

---

### Task 1: Split shared request contracts

**Files:** `packages/shared/src/index.ts`, `packages/shared/src/__tests__/ai-settings.test.ts`

- [x] Add failing tests for `{ apiKey }` provider-key requests and `{ provider, model }` model requests, including blank key and mismatched model rejection.
- [x] Run shared tests and verify missing schemas fail.
- [x] Add `saveAiProviderKeyRequestSchema` and `selectAiModelRequestSchema` with inferred types; remove the combined update contract.
- [x] Run shared tests.

### Task 2: Split service and HTTP endpoints

**Files:** `apps/api/src/services/ai-provider.ts`, `apps/api/src/routes/ai.ts`, `apps/api/src/__tests__/ai-provider.test.ts`, `apps/api/src/__tests__/ai-routes.test.ts`

- [x] Write failing service tests proving `saveKey` preserves provider/model and other keys, while `selectModel` requires a configured provider.
- [x] Write failing route tests for `PUT /api/ai/keys/:provider` and `PUT /api/ai/model`, plus removal of `PUT /api/ai`.
- [x] Run focused tests and verify failures.
- [x] Replace `save` with `saveKey` and `selectModel`, retaining encryption, user filters, cache invalidation, and secret-free status responses.
- [x] Replace the combined route with two zod-validated routes.
- [x] Run API tests and typecheck.

### Task 3: Provider cards and filtered model selector

**Files:** `apps/web/src/lib/api-client.ts`, `apps/web/src/routes/_authed/settings.tsx`, `apps/web/src/routes/_authed/-settings.test.tsx`

- [x] Add failing UI tests for three provider inputs, independent key save, only configured-provider models, no-key empty state, and separate model save.
- [x] Run focused web tests and verify failures.
- [x] Replace `updateAiSettings` with `saveAiProviderKey` and `selectAiModel` API client methods.
- [x] Render provider cards with per-provider key state, save/test/delete actions, and a separate filtered model form.
- [x] Run web tests and typecheck.

### Task 4: Documentation and verification

**Files:** `docs/03-api.md`, `docs/05-ai.md`, `docs/07-ui.md`, `PROGRESS.md`

- [x] Document split endpoints, provider cards, filtered models, and empty state.
- [x] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [x] Rebuild Docker and browser-check OpenAI configured card, three independent key inputs, OpenAI-only model list, connection test, and model save.
- [x] Mark the plan complete, update progress evidence, run `git diff --check`, and commit focused changes.
