# Mobile Library And Menu Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the mobile shell and library controls, make logout available at the bottom of Settings, and make bookmark tags, dialogs, editing, and menus behave consistently.

**Architecture:** Keep the authenticated layout as the owner of global navigation and logout mechanics, while extracting the logout side effect into a reusable helper for Settings. Keep bookmark mutations in the existing dialogs; move category selection into `EditBookmarkDialog` and give each card popover an explicit dismissal lifecycle. Responsive behavior remains Tailwind/CSS based with no new dependency.

**Tech Stack:** React 19, TanStack Router/Query, Tailwind CSS v4, Vitest, Testing Library, Biome.

---

### Task 1: Simplify the responsive shell and library controls

**Files:**
- Modify: `apps/web/src/routes/_authed/route.tsx`
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] Add a failing HomePage test asserting the library hero heading is absent while the labelled search input and category filters remain.
- [ ] Run `bun run --filter @my-bookmark/web test -- -t "renders search controls without a library hero"` and confirm it fails on the existing heading.
- [ ] Remove the `library-toolbar` hero, render a plain search/filter section directly below the app shell header, hide the global header below `sm`, and render the desktop add action as a circular floating `+` button at the bottom-right.
- [ ] Run the targeted test and confirm it passes.

### Task 2: Add Settings logout

**Files:**
- Create: `apps/web/src/lib/logout.ts`
- Modify: `apps/web/src/routes/_authed/route.tsx`
- Modify: `apps/web/src/routes/_authed/settings.tsx`
- Test: `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] Add a failing test that renders the exported logout section, clicks `로그아웃`, and verifies the shared logout helper receives the active QueryClient.
- [ ] Run `bun run --filter @my-bookmark/web test -- -t "logs out from the bottom of settings"` and confirm it fails because the section is absent.
- [ ] Extract Supabase sign-out, service-worker cache clearing, query-cache clearing, and login redirect to `performLogout`; use it from both the desktop header and a final Settings danger section.
- [ ] Run the targeted test and confirm it passes.

### Task 3: Make the add dialog opaque and move category editing into Edit

**Files:**
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] Add failing tests asserting the add dialog has an opaque-surface class and the edit dialog exposes a `카테고리` select whose value is included in `updateBookmark`.
- [ ] Run the two targeted tests and confirm the missing class/select failures.
- [ ] Add an opaque modifier to `BookmarkDialog`, pass categories to `EditBookmarkDialog`, and include `categoryId` (or `null` for 미분류) in its existing update mutation.
- [ ] Remove direct category mutation controls from the card menu and delete the now-unused HomePage move mutation.
- [ ] Run the targeted tests and confirm they pass.

### Task 4: Give bookmark popovers a complete dismissal lifecycle

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Test: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] Add failing tests that open a bookmark menu and verify it closes after an outside pointer event, Escape, and a menu action.
- [ ] Run `bun run --filter @my-bookmark/web test -- -t "dismisses the bookmark menu"` and confirm the menu remains rendered.
- [ ] Add a popover ref plus document pointer/Escape listeners while open, and wrap action callbacks so selection closes the popover before running the action.
- [ ] Run the targeted tests and confirm they pass.

### Task 5: Compact tag badges at every breakpoint

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`
- Modify: `docs/07-ui.md`
- Modify: `docs/superpowers/specs/2026-07-12-apple-ui-redesign-design.md`

- [ ] Update the responsive tag test to require compact mobile and desktop classes with WCAG-safe zinc-600 text.
- [ ] Run the targeted tag test and confirm the existing desktop 44px button fails the compact requirement.
- [ ] Apply the same compact visual sizing to both representations while preserving mobile read-only semantics and desktop click-to-search behavior.
- [ ] Run the targeted tag and desktop search behavior tests and confirm they pass.

### Task 6: Verify and record the result

**Files:**
- Modify: `PROGRESS.md`

- [ ] Run Biome write/check on touched TypeScript files.
- [ ] Run `git diff --check`.
- [ ] Run `bun run typecheck && bun run lint && bun run test && bun run build`; if API tests hit sandbox `listen EPERM`, rerun tests with permitted local binding.
- [ ] Update `PROGRESS.md` with the responsive shell, logout, opaque add dialog, popover dismissal, edit-category, compact tag decisions, and actual verification counts.
- [ ] Review the final diff for Critical/Important issues before committing.

### Task 7: Unify opaque dialogs and replace desktop navigation with a menu

**Files:**
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Modify: `apps/web/src/routes/_authed/route.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/src/routes/_authed/-route.test.tsx`
- Test: `apps/web/src/routes/_authed/-index.test.tsx`

- [ ] Add failing assertions that add/edit dialogs both use the opaque surface and a lightly blurred scrim.
- [ ] Add a failing isolated `DesktopMenu` test for hamburger disclosure, the three destinations, logout, and dismissal after selection.
- [ ] Mark Edit as opaque, apply a small shared backdrop blur to dialog scrims, and keep surfaces solid.
- [ ] Replace `desktop-nav` and standalone logout with an exported desktop hamburger popover that closes on outside pointer, Escape, and action.
- [ ] Run targeted tests, then repeat the full verification loop and final review.
