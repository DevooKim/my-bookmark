# Bun Package Manager and Vercel Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pnpm with Bun across the monorepo, move Node-based production paths to Node.js 24 LTS, and deploy the web app on Vercel's Bun 1.x Beta runtime.

**Architecture:** Bun owns dependency resolution, the workspace graph, local scripts, and container build installs through one root `bun.lock`. The API and Docker outputs continue to run on Node.js, upgraded to Node 24; only the Nitro web functions emitted for Vercel opt into Bun Beta through project configuration.

**Tech Stack:** Bun 1.3.14, Node.js 24 LTS, Bun workspaces, TanStack Start, Nitro, Vercel, Docker, Vitest

---

### Task 1: Define Bun workspace behavior

**Files:**
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/__tests__/pwa-config.test.ts`
- Delete: `pnpm-workspace.yaml`
- Create: `bun.lock`
- Delete: `pnpm-lock.yaml`

- [ ] **Step 1: Update the package-script regression test**

Change the PWA config assertion to require the web build script to start with `bun run build:sw &&`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun run --filter @my-bookmark/web test -- -t "builds the service worker"`

Expected: FAIL because `apps/web/package.json` still invokes pnpm.

- [ ] **Step 3: Convert the workspace manifest**

Set `packageManager` to `bun@1.3.14`, add `workspaces: ["apps/*", "packages/*"]`, replace recursive pnpm scripts with Bun workspace scripts, replace `pnpm.onlyBuiltDependencies` with `trustedDependencies`, and replace internal web script calls with `bun run`.

- [ ] **Step 4: Migrate the lockfile**

Run: `bun install --lockfile-only`

Expected: `bun.lock` is created from the existing pnpm resolution without package manifest errors. Remove `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then run `bun install --frozen-lockfile` successfully.

- [ ] **Step 5: Re-run the focused test**

Run: `bun run --filter @my-bookmark/web test -- -t "builds the service worker"`

Expected: PASS.

### Task 2: Upgrade Node production paths and Docker installs

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsup.config.ts`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/web/Dockerfile`

- [ ] **Step 1: Update API build targets**

Replace both `node22` tsup targets with `node24` so the explicit command and the checked-in config agree.

- [ ] **Step 2: Convert Docker build stages**

Use `oven/bun:1.3.14-alpine` for dependency-install/build stages, copy `bun.lock` plus all required workspace manifests, run `bun install --frozen-lockfile` with the appropriate workspace filter, and invoke workspace builds with `bun run --filter <workspace> build`.

- [ ] **Step 3: Upgrade final runtime images**

Use `node:24-alpine` for both final runtime stages. Preserve the self-contained Nitro output boundary for web and the API production dependency plus bundled `dist` boundary for API.

- [ ] **Step 4: Verify local production builds**

Run: `bun run --filter @my-bookmark/api build && bun run --filter @my-bookmark/web build`

Expected: both commands exit 0 and emit `apps/api/dist/index.js` and `apps/web/.output/server/index.mjs`.

### Task 3: Configure Vercel Bun Beta deployment

**Files:**
- Create: `apps/web/vercel.json`
- Modify: `apps/web/vite.config.ts` only if installed Nitro types or a Vercel-mode build proves that automatic preset detection is insufficient

- [ ] **Step 1: Add Vercel project configuration**

Create `apps/web/vercel.json` with the official schema and `"bunVersion": "1.x"`. Do not set API secrets or a Node runtime override.

- [ ] **Step 2: Add a static configuration assertion**

Extend `apps/web/src/__tests__/pwa-config.test.ts` to parse `apps/web/vercel.json` and assert the Bun runtime value.

- [ ] **Step 3: Run the web config tests**

Run: `bun run --filter @my-bookmark/web test -- -t "PWA build configuration"`

Expected: PASS with both Bun build-command and Vercel runtime assertions.

- [ ] **Step 4: Exercise the Vercel build mode**

Run: `VERCEL=1 bun run --filter @my-bookmark/web build`

Expected: Nitro exits 0 and emits the Vercel deployment shape. If it does not, inspect installed Nitro types and use its supported Vercel preset configuration instead of a type escape.

### Task 4: Update active instructions and deployment documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `apps/web/README.md`
- Modify: `docs/01-architecture.md`
- Modify: `docs/08-performance.md`
- Modify: `docs/09-roadmap.md`
- Modify: `docs/deploy.md`
- Modify: `docs/vapid-guide.md`

- [ ] **Step 1: Replace active pnpm instructions**

Use Bun equivalents for install, recursive validation, workspace filtering, executable invocation, scaffolding examples, Lighthouse execution, Supabase commands, VAPID generation, and bookmark seeding.

- [ ] **Step 2: Document deployment boundaries**

Record Node 24 for API/Docker runtime, Bun for package management, `apps/web` as the Vercel Root Directory, Bun 1.x Beta for Vercel functions, and the four public `VITE_*` variables required by the web project.

- [ ] **Step 3: Search active files for stale pnpm commands**

Run: `rg -n "pnpm|node:22|node22" AGENTS.md CLAUDE.md README.md package.json apps docs/01-architecture.md docs/08-performance.md docs/09-roadmap.md docs/deploy.md docs/vapid-guide.md`

Expected: no active pnpm or Node 22 instruction remains; historical `docs/superpowers` records are excluded.

### Task 5: Verify and record the migration

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run the full Bun verification loop**

Run: `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test && bun run build`

Expected: every command exits 0 with no skipped failure.

- [ ] **Step 2: Verify production startup**

Run the built API with Node.js 24 and request `/api/health`; run the built web output and request `/manifest.webmanifest`.

Expected: API returns `{"ok":true}` and the manifest returns HTTP 200.

- [ ] **Step 3: Build both Docker images**

Run: `docker compose build api web`

Expected: both images build with Bun installs and Node 24 runtime layers.

- [ ] **Step 4: Update progress**

Add a decision-log entry describing Bun 1.3.14, Node 24, and the Vercel Bun Beta boundary. Record exact passing checks and any environmental limitation without claiming unrun verification.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check`, inspect `git diff --stat`, and confirm unrelated untracked skill files remain untouched.
