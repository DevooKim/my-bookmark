# Apple UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 기능을 보존하며 my-bookmark 전체 화면을 Apple식 반응형 디자인 시스템으로 개편한다.

**Architecture:** `styles.css`에 색상, 소재, 상호작용, 접근성 토큰과 semantic component class를 정의한다. 각 route는 데이터 로직을 유지하고 화면 구조와 class만 새 시스템에 맞춘다.

**Tech Stack:** React 19, TanStack Start, Tailwind CSS v4, lucide-react, Vitest, Testing Library

---

### Task 1: UI 계약 테스트

**Files:**
- Create: `apps/web/src/routes/_authed/-route.test.tsx`
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`

- [x] 앱 셸이 `My Bookmark`, `라이브러리`, `리마인더`, `설정` navigation을 렌더하는 실패 테스트를 작성한다.
- [x] 홈 화면이 `라이브러리` heading, `북마크 검색`, `북마크 추가`를 제공하는 실패 테스트를 작성한다.
- [x] `bun run --filter @my-bookmark/web test -- -t "Apple UI"`로 의도한 실패를 확인한다.

### Task 2: 공통 디자인 시스템과 앱 셸

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/routes/_authed/route.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

- [x] semantic class `app-shell`, `glass-bar`, `surface`, `page-title`, `nav-item`을 정의한다.
- [x] 공통 버튼은 `:active { transform: scale(.97) }`와 `focus-visible` ring을 사용한다.
- [x] safe-area 및 reduced motion/transparency/contrast media query를 추가한다.
- [x] 앱 셸 navigation과 loading/error surface를 새 구조로 변경하고 테스트를 통과시킨다.

### Task 3: 라이브러리와 시트

**Files:**
- Modify: `apps/web/src/routes/_authed/index.tsx`
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Modify: `apps/web/src/routes/_authed/-components/tag-input.tsx`

- [x] 검색 label에 접근 가능한 이름을 주고 새 heading/call-to-action 계약을 구현한다.
- [x] 카드, badge, menu, empty/loading surface를 공통 디자인 시스템으로 교체한다.
- [x] dialog에 `role="dialog"`, `aria-modal="true"`, 접근 가능한 제목 연결을 추가하고 모바일 sheet/데스크톱 dialog 재질을 적용한다.
- [x] 홈 테스트와 dialog 테스트를 통과시킨다.

### Task 4: 리마인더, 설정, 로그인

**Files:**
- Modify: `apps/web/src/routes/_authed/reminders.tsx`
- Modify: `apps/web/src/routes/_authed/settings.tsx`
- Modify: `apps/web/src/routes/login.tsx`

- [x] 세 화면의 page header, surface, field, status/error 표현을 semantic class로 통일한다.
- [x] 기존 form label, mutation, toast, confirm 동작을 보존한다.
- [x] 기존 설정 및 로그인 테스트를 실행해 회귀가 없음을 확인한다.

### Task 5: 검증과 기록

**Files:**
- Modify: `PROGRESS.md`

- [x] `bun run typecheck && bun run lint && bun run test && bun run build`를 모두 통과시킨다.
- [x] 실제 앱을 375px과 데스크톱 dark/system 테마에서 열고, light token 및 reduced-motion media query는 빌드된 CSS로 확인한다.
- [x] 구현 범위, 검증 결과, 남은 외부 검증을 `PROGRESS.md`에 기록한다.
