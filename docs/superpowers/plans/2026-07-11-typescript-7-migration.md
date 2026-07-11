# TypeScript 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every workspace to TypeScript 7.0.2 and align the web workspace's Node declarations with Node.js 24.

**Architecture:** Keep the existing strict/Bundler tsconfig structure and change only dependency declarations plus the Bun lockfile. A manifest regression test enforces one compiler version across the monorepo before the full application verification loop proves source and tool compatibility.

**Tech Stack:** TypeScript 7.0.2, Bun 1.3.14 workspaces, Node.js 24, Vitest, Docker

---

### Task 1: Enforce one compiler version

**Files:**
- Modify: `apps/web/src/__tests__/pwa-config.test.ts`
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/ai/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add a failing manifest regression test**

Add a test that reads all five package manifests, asserts every `devDependencies.typescript` equals `7.0.2`, and asserts `apps/web` declares `@types/node` with a Node 24 range.

- [ ] **Step 2: Verify the test fails for the current declarations**

Run: `fnm exec --using=24.14.0 bun run --filter @my-bookmark/web test -- -t "pins TypeScript 7"`

Expected: FAIL because root/API/shared/AI use `latest`, web uses `^6.0.2`, and web uses Node 22 types.

- [ ] **Step 3: Pin compiler and Node declarations**

Set `typescript` to `7.0.2` in the root and every workspace. Set web `@types/node` to `^24.0.0`. Do not change tsconfig compiler options.

- [ ] **Step 4: Refresh and freeze the lockfile**

Run: `bun install`, then `bun install --frozen-lockfile`.

Expected: both exit 0 and `bun.lock` contains TypeScript 7.0.2 as the workspace compiler resolution.

- [ ] **Step 5: Verify the focused test passes**

Run: `fnm exec --using=24.14.0 bun run --filter @my-bookmark/web test -- -t "pins TypeScript 7"`

Expected: PASS.

### Task 2: Validate TypeScript 7 compatibility

**Files:**
- Modify: only source or tsconfig files that produce genuine TypeScript 7 diagnostics

- [ ] **Step 1: Confirm the compiler version**

Run: `fnm exec --using=24.14.0 bunx --no-install tsc --version`

Expected: `Version 7.0.2`.

- [ ] **Step 2: Run strict type checking**

Run: `fnm exec --using=24.14.0 bun run typecheck`.

Expected: PASS. If TypeScript 7 emits a source diagnostic, fix its root cause without `any`, `@ts-ignore`, `skipLibCheck`, or strictness reduction and rerun this command.

- [ ] **Step 3: Run lint, tests, and builds**

Run: `fnm exec --using=24.14.0 bun run lint`, `fnm exec --using=24.14.0 bun run test`, and `fnm exec --using=24.14.0 bun run build`.

Expected: all commands exit 0 and all existing tests pass.

- [ ] **Step 4: Verify Docker production builds**

Run: `docker compose build api web && docker compose up -d`, then request `/api/health` and `/manifest.webmanifest`.

Expected: both services are healthy, API returns `{"ok":true}`, and the manifest returns HTTP 200.

### Task 3: Record and commit the migration

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/01-architecture.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update active stack documentation**

Record TypeScript 7.0.2 in the agent instructions and architecture version policy. Keep historical progress entries unchanged.

- [ ] **Step 2: Record the decision and exact verification result**

Add a `PROGRESS.md` decision entry explaining the exact-version policy and a verification entry with the actual test count and Docker results.

- [ ] **Step 3: Search for stale active TypeScript declarations**

Run: `rg -n 'typescript.*(latest|\\^6)|@types/node.*22' package.json apps packages AGENTS.md CLAUDE.md docs/01-architecture.md`.

Expected: no matches in active manifests or current documentation.

- [ ] **Step 4: Review and commit**

Run `git diff --check`, inspect the scoped diff, leave `.agents/skills/*` untouched, and commit with `chore: TypeScript 7로 통일`.
