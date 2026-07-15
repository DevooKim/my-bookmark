# Bookmark Menu Stacking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep an opened bookmark card menu above the following virtualized card on touch devices.

**Architecture:** Mark each virtual bookmark row with a stable class and use the menu trigger's existing `aria-expanded` state as the CSS stacking signal. Preserve the current local menu state, dismissal behavior, and popover positioning.

**Tech Stack:** React 19, Tailwind CSS v4, CSS `:has()`, Vitest, Testing Library

---

### Task 1: Add a failing stacking regression test

**Files:**
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`
- Create: `apps/web/src/__tests__/styles.test.ts`

- [x] **Step 1: Assert that rendered virtual rows expose `virtual-bookmark-row`**

Render one bookmark, locate the menu trigger with `closest(".virtual-bookmark-row")`, and expect a row to exist.

- [x] **Step 2: Assert that the stylesheet raises a row containing an expanded trigger**

Read `src/styles.css` and expect a `.virtual-bookmark-row:has([aria-expanded="true"])` rule containing `z-index`.

- [x] **Step 3: Run the focused tests and verify RED**

Run `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx src/__tests__/styles.test.ts`. Expect the new row class and CSS rule assertions to fail.

### Task 2: Implement the stacking rule

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1: Mark virtual bookmark rows**

Add `virtual-bookmark-row` to the absolutely positioned row wrapper while retaining the current `focus-within:z-10` fallback.

- [x] **Step 2: Raise the row while its menu is expanded**

Add this focused rule:

```css
.virtual-bookmark-row:has([aria-expanded="true"]) {
  z-index: 20;
}
```

- [x] **Step 3: Run the focused tests and verify GREEN**

Run `bun run --cwd apps/web test -- src/routes/_authed/-index.test.tsx src/__tests__/styles.test.ts`. Expect both files to pass.

### Task 3: Verify and document

**Files:**
- Modify: `PROGRESS.md`

- [x] **Step 1: Run full verification**

Run `bun run typecheck && bun run lint && bun run test && bun run build`. Expect exit code 0.

- [x] **Step 2: Record the fix and verification totals**

Add the iOS-safe menu stacking decision and final test totals to `PROGRESS.md`.

- [x] **Step 3: Commit only the UI fix, tests, plan, and progress log**

```bash
git add PROGRESS.md apps/web/src/routes/_authed/index.tsx apps/web/src/routes/_authed/-index.test.tsx apps/web/src/styles.css apps/web/src/__tests__/styles.test.ts docs/superpowers/plans/2026-07-15-bookmark-menu-stacking.md
git commit -m "fix: 카드 메뉴가 목록 위에 표시되도록 수정"
```
