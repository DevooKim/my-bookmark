# AI Model Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move active model selection above provider key management and present it as a rounded bordered card.

**Architecture:** Reorder existing JSX only; preserve all query, mutation, and filtering behavior.

**Tech Stack:** React 19, Tailwind CSS v4, Testing Library, Vitest.

---

### Task 1: Reorder and style AI settings

**Files:** `apps/web/src/routes/_authed/settings.tsx`, `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] Add a failing test that the `사용 모델` heading precedes `AI API 키` and its parent card has rounded/border classes.
- [ ] Run the focused test and verify failure.
- [ ] Move the existing model block above key cards and apply `rounded-xl border border-zinc-200 p-4 dark:border-zinc-800`.
- [ ] Run focused tests and web typecheck.

### Task 2: Verify and document

**Files:** `PROGRESS.md`

- [ ] Record the layout refinement and verification.
- [ ] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] Rebuild Docker, browser-check order/card styling, mark plan complete, and commit.
