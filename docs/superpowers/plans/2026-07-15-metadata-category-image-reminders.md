# Metadata, Category, Image Colour and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메타데이터·모바일 카테고리·이미지 색상 문제를 수정하고, 이력이 남는 단발 및 반복 리마인더를 구현한다.

**Architecture:** UI의 작은 스타일 변경은 기존 컴포넌트에 국소 적용한다. 이미지 파생본은 Sharp 출력 경계에서 sRGB ICC로 정규화한다. 리마인더는 기존 행에 반복 규칙과 다음 실행 시각을 보관하고 조건부 update로 한 worker만 단발 완료 또는 반복 다음 회차 전이를 수행한다.

**Tech Stack:** TypeScript 7 strict, React 19, TanStack Query, Express 5, Zod, Supabase Postgres, Sharp 0.35, Vitest, Tailwind CSS v4

---

### Task 1: 메타데이터 호버와 모바일 카테고리 한 줄

**Files:**
- Modify: `apps/web/src/routes/_authed/-components/bookmark-metadata.tsx`
- Modify: `apps/web/src/routes/_authed/-index.test.tsx`
- Modify: `apps/web/src/routes/_authed/settings.tsx`
- Modify: `apps/web/src/routes/_authed/-settings.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`-index.test.tsx`에서 네이버지도와 일반 URL 모두 `hover:bg-blue-700 hover:text-white`를 가지며 녹색 특례가 없음을 단언한다. `-settings.test.tsx`에서는 행이 `grid-cols-[auto_minmax(0,1fr)_auto_auto]`이고 handle/input/count/delete가 별도 열의 한 행에 있는지 확인한다.

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd apps/web test src/routes/_authed/-index.test.tsx src/routes/_authed/-settings.test.tsx`

Expected: 기존 녹색 hover와 모바일 2단 class 때문에 FAIL.

- [ ] **Step 3: 최소 구현**

URL 뱃지 class를 공통 문자열로 바꾸고 key별 분기를 삭제한다.

```tsx
className={`inline-flex max-w-full truncate rounded-lg bg-blue-50 px-2 py-1 font-medium text-blue-700 hover:bg-blue-700 hover:text-white dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-600 dark:hover:text-white${interactive ? " pointer-events-auto relative z-20" : ""}`}
```

카테고리 행은 네 열 한 줄로 바꾼다.

```tsx
<SortableRow
  className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1.5 py-3 sm:gap-2"
  handleLabel={`${category.name} 순서 변경`}
  id={category.id}
>
  <input className="input min-w-0" />
  <span className="shrink-0 text-sm text-zinc-500">{count}개</span>
  <button className="icon-button shrink-0 text-red-600" />
</SortableRow>
```

- [ ] **Step 4: GREEN 확인**

Run: `bun run --cwd apps/web test src/routes/_authed/-index.test.tsx src/routes/_authed/-settings.test.tsx`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/routes/_authed/-components/bookmark-metadata.tsx apps/web/src/routes/_authed/-index.test.tsx apps/web/src/routes/_authed/settings.tsx apps/web/src/routes/_authed/-settings.test.tsx
git commit -m "fix: 메타데이터와 모바일 카테고리 UI 정리"
```

### Task 2: 이미지 파생본 sRGB 정규화

**Files:**
- Modify: `apps/api/src/__tests__/image-processing.test.ts`
- Modify: `apps/api/src/services/image-processing.ts`

- [ ] **Step 1: wide-gamut 실패 테스트 작성**

Display P3 프로필이 붙은 PNG를 만든 뒤 WebP와 JPEG metadata를 검사한다.

```ts
const p3 = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "#ff4f40" },
})
  .png()
  .withIccProfile("p3")
  .toBuffer();
const result = await processImage(p3, "p3.png");
for (const output of [result.thumbnail, result.analysisImage]) {
  const metadata = await sharp(output).metadata();
  expect(metadata.space).toBe("srgb");
  expect(metadata.icc?.byteLength).toBeGreaterThan(0);
}
```

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd apps/api test src/__tests__/image-processing.test.ts`

Expected: 기존 파생본에 ICC가 없어 FAIL.

- [ ] **Step 3: 최소 구현**

thumbnail과 analysis 파이프라인에서 encoder 직전에 `.withIccProfile("srgb")`를 호출한다. 원본·크기·품질 설정은 변경하지 않는다.

- [ ] **Step 4: GREEN 확인**

Run: `bun run --cwd apps/api test src/__tests__/image-processing.test.ts`

Expected: HEIC, 크기 제한, P3 회귀 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/services/image-processing.ts apps/api/src/__tests__/image-processing.test.ts
git commit -m "fix: 이미지 파생본 색공간을 sRGB로 고정"
```

### Task 3: 반복 리마인더 공유 계약과 DB 마이그레이션

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/reminders.test.ts`
- Create: `supabase/migrations/20260715_reminder_recurrence.sql`
- Modify: `docs/02-database.md`
- Modify: `docs/03-api.md`

- [ ] **Step 1: 공유 계약 실패 테스트 작성**

```ts
expect(createReminderRequestSchema.parse({
  bookmarkId,
  remindAt,
  recurrence: "weekly",
  recurrenceTimezone: "Asia/Seoul",
})).toMatchObject({ recurrence: "weekly" });
expect(() => createReminderRequestSchema.parse({
  bookmarkId,
  remindAt,
  recurrence: "hourly",
  recurrenceTimezone: "Asia/Seoul",
})).toThrow();
```

응답 스키마가 `recurrence`, `recurrenceTimezone`, `isEnabled`를 요구하고 reschedule body가 미래 시각·반복·timezone·note를 파싱하는 테스트도 추가한다. `recurrence_day`는 서버가 설정 시각에서 파생하는 DB 내부 필드이므로 API 응답에는 노출하지 않는다.

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd packages/shared test src/__tests__/reminders.test.ts`

Expected: 새 schema export가 없어 FAIL.

- [ ] **Step 3: 공유 Zod 계약 구현**

```ts
export const reminderRecurrenceSchema = z.enum([
  "none",
  "daily",
  "weekly",
  "monthly",
]);
export const reminderTimezoneSchema = z.string().trim().min(1).max(100);
```

create request에는 기본값을 두지 않고 UI/API가 명시적으로 전달하게 한다. update request에는 `recurrence`, `recurrenceTimezone`, `isEnabled`를 optional로 추가한다. `rescheduleReminderRequestSchema`는 `remindAt`, nullable note, recurrence, timezone을 요구한다. reminder response에 세 필드를 추가한다.

- [ ] **Step 4: 마이그레이션 작성**

```sql
alter table public.reminders
  add column recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','monthly')),
  add column recurrence_timezone text not null default 'UTC',
  add column recurrence_day smallint
    check (recurrence_day between 1 and 31),
  add column is_enabled boolean not null default true;

drop index if exists public.reminders_due_idx;
create index reminders_due_idx
  on public.reminders (status, is_enabled, remind_at);
```

- [ ] **Step 5: GREEN 및 SQL 정적 확인**

Run: `bun run --cwd packages/shared test src/__tests__/reminders.test.ts && bun run --cwd packages/shared typecheck`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/index.ts packages/shared/src/__tests__/reminders.test.ts supabase/migrations/20260715_reminder_recurrence.sql docs/02-database.md docs/03-api.md
git commit -m "feat: 반복 리마인더 데이터 계약 추가"
```

### Task 4: timezone 기반 다음 반복 시각 계산

**Files:**
- Create: `apps/api/src/services/reminder-recurrence.ts`
- Create: `apps/api/src/__tests__/reminder-recurrence.test.ts`

- [ ] **Step 1: 계산 실패 테스트 작성**

`nextReminderAt`이 Asia/Seoul 기준 daily/weekly/monthly를 계산하고 1월 31일 다음 월을 2월 말로 보정하며, `now`보다 미래가 될 때까지 누락 회차를 건너뛰는 사례를 작성한다. 잘못된 timezone은 `Invalid reminder timezone` 오류를 기대한다.

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminder-recurrence.test.ts`

Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 최소 구현**

```ts
export function assertReminderTimezone(timeZone: string): void {
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
}

export function nextReminderAt(input: {
  scheduledAt: Date;
  recurrence: Exclude<ReminderRecurrence, "none">;
  timeZone: string;
  now: Date;
  recurrenceDay?: number | null;
}): Date {
  assertReminderTimezone(input.timeZone);
  let local = localParts(input.scheduledAt, input.timeZone);
  for (let attempts = 0; attempts < 10_000; attempts += 1) {
    local = incrementLocal(
      local,
      input.recurrence,
      input.recurrenceDay ?? local.day,
    );
    const candidate = localToDate(local, input.timeZone);
    if (candidate.getTime() > input.now.getTime()) {
      return candidate;
    }
  }
  throw new Error("Unable to calculate next reminder occurrence");
}
```

`localParts`는 `Intl.DateTimeFormat(...).formatToParts()`를 숫자 필드로 파싱한다. `incrementLocal`은 daily/weekly에는 UTC calendar arithmetic을 사용하고 monthly에는 다음 연·월의 마지막 날과 `recurrenceDay` 중 작은 값을 사용한다. `localToDate`는 로컬 구성요소를 UTC로 간주한 epoch에서 formatter로 구한 timezone offset을 두 번 보정해 DST offset 변경 뒤에도 같은 유효 로컬 시각을 보존한다.

- [ ] **Step 4: GREEN 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminder-recurrence.test.ts`

Expected: 전 사례 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/services/reminder-recurrence.ts apps/api/src/__tests__/reminder-recurrence.test.ts
git commit -m "feat: 반복 리마인더 다음 시각 계산 추가"
```

### Task 5: 리마인더 목록·상태·다시 알림 API

**Files:**
- Modify: `apps/api/src/routes/reminders.ts`
- Modify: `apps/api/src/lib/db-mappers.ts`
- Modify: `apps/api/src/__tests__/reminders-routes.test.ts`

- [ ] **Step 1: route 실패 테스트 확장**

Fake DB에 pending/sent/cancelled/disabled recurring 행을 넣고 다음을 검증한다.

```ts
expect(list.body.items.map((item: { status: string }) => item.status))
  .toEqual(["sent", "pending", "pending"]);
```

추가로 sent 단발 reschedule이 같은 id를 pending으로 되돌리는지, repeating toggle이 false/true로 바뀌는지, 단발 disable·취소된 행·타 사용자 행·과거 시각·잘못된 timezone이 거부되는지, DELETE가 sent도 cancelled로 만드는지 검사한다.

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminders-routes.test.ts`

Expected: 목록이 pending만 반환하고 새 필드·endpoint가 없어 FAIL.

- [ ] **Step 3: mapper와 DB interface 구현**

DB row와 mapper에 `recurrence`, `recurrence_timezone`, `recurrence_day`, `is_enabled`를 추가한다. API mapper는 내부 `recurrence_day`를 노출하지 않는다. `listPending`을 `listVisible`로 바꾸고 `.neq("status", "cancelled")`로 조회한다. 취소 method는 pending/sent 모두 대상이 되도록 status equality를 제거한다.

- [ ] **Step 4: update와 reschedule endpoint 구현**

PATCH는 timezone을 검증하고 단발 disable을 400으로 거부한다. monthly 설정·재설정 시 설정 시각의 로컬 day를 `recurrence_day`에 저장하고 다른 주기는 null로 만든다. 비활성 반복을 활성화할 때 `remind_at <= now`이면 anchor day를 포함한 `nextReminderAt`으로 이동한다. `POST /reminders/:id/reschedule`은 미래 시각을 검증하고 sent·사용자 소유·non-cancelled 조건으로 status pending, sent_at null, 새 규칙, enabled true를 저장한다.

- [ ] **Step 5: GREEN 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminders-routes.test.ts && bun run --cwd apps/api typecheck`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/reminders.ts apps/api/src/lib/db-mappers.ts apps/api/src/__tests__/reminders-routes.test.ts
git commit -m "feat: 리마인더 이력과 상태 변경 API 추가"
```

### Task 6: 반복 리마인더 스케줄러

**Files:**
- Modify: `apps/api/src/services/reminder-cron.ts`
- Modify: `apps/api/src/__tests__/reminder-cron.test.ts`

- [ ] **Step 1: cron 실패 테스트 작성**

단발 claim은 sent로, 반복 claim은 다음 미래 시각으로 이동하는 인자를 DB에 전달하는지 검사한다. 경쟁 claim false는 미발송, 비활성 행은 due adapter 조회에서 제외되는 query 계약으로 고정한다.

- [ ] **Step 2: RED 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminder-cron.test.ts`

Expected: claim signature와 반복 데이터가 없어 FAIL.

- [ ] **Step 3: 조건부 claim 구현**

`DueReminderRow`에 반복 필드를 추가하고 `claimReminder` 입력을 `{ id, expectedRemindAt, transition }`으로 바꾼다. adapter update에는 `.eq("status", "pending").eq("is_enabled", true).eq("remind_at", expectedRemindAt)`를 적용한다. 반복 transition은 `nextReminderAt` 결과, 단발은 sent를 전달한다.

- [ ] **Step 4: GREEN 확인**

Run: `bun run --cwd apps/api test src/__tests__/reminder-cron.test.ts && bun run --cwd apps/api test src/__tests__/reminders-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/services/reminder-cron.ts apps/api/src/__tests__/reminder-cron.test.ts
git commit -m "feat: 반복 리마인더 스케줄링 추가"
```

### Task 7: 반복 설정·지난 일정·다시 알림 웹 UI

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx`
- Create: `apps/web/src/routes/_authed/-reminder-dialog.test.tsx`
- Modify: `apps/web/src/routes/_authed/reminders.tsx`
- Create: `apps/web/src/routes/_authed/-reminders.test.tsx`

- [ ] **Step 1: API client와 dialog 실패 테스트 작성**

모달에서 `매주`를 선택하고 저장했을 때 create body가 다음을 포함하는지 검사한다.

```ts
expect(createReminder).toHaveBeenCalledWith(expect.objectContaining({
  recurrence: "weekly",
  recurrenceTimezone: "Asia/Seoul",
}));
```

reschedule mode에서는 기존 note를 표시하고 `rescheduleReminder(id, body)`를 호출한다.

- [ ] **Step 2: 목록 실패 테스트 작성**

fake timer로 현재 시각을 고정해 지난 sent 항목의 date/icon red class, `다시 알림`, 반복 badge, 활성 toggle, 비활성 회색 상태, 모든 행의 삭제 버튼과 query invalidate를 검사한다.

- [ ] **Step 3: RED 확인**

Run: `bun run --cwd apps/web test src/routes/_authed/-reminder-dialog.test.tsx src/routes/_authed/-reminders.test.tsx`

Expected: 새 UI와 client 함수가 없어 FAIL.

- [ ] **Step 4: API client와 모달 구현**

`rescheduleReminder`, 확장된 `createReminder`/update 호출을 Zod response 경계와 함께 추가한다. `ReminderDialog`에 optional `{ reminder, mode }`를 받아 create/reschedule을 분기하고 반복 select와 browser timezone을 전송한다.

- [ ] **Step 5: 목록 UI 구현**

`Date.now() > new Date(remindAt).getTime()`으로 지난 여부를 계산한다. `status==='sent' && recurrence==='none'`에는 다시 알림, `recurrence!=='none'`에는 반복 badge와 활성 toggle을 표시한다. toggle/delete/reschedule 성공 시 `['reminders']`를 invalidate한다.

- [ ] **Step 6: GREEN 확인**

Run: `bun run --cwd apps/web test src/routes/_authed/-reminder-dialog.test.tsx src/routes/_authed/-reminders.test.tsx && bun run --cwd apps/web typecheck`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/routes/_authed/-components/bookmark-dialogs.tsx apps/web/src/routes/_authed/-reminder-dialog.test.tsx apps/web/src/routes/_authed/reminders.tsx apps/web/src/routes/_authed/-reminders.test.tsx
git commit -m "feat: 반복과 다시 알림 UI 추가"
```

### Task 8: 문서·마이그레이션·전체 검증

**Files:**
- Modify: `docs/06-pwa-push.md`
- Modify: `docs/09-roadmap.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 문서 갱신**

발송 후 목록에서 사라진다는 기존 설명을 이력 유지·반복 다음 회차 갱신으로 바꾼다. API·DB 문서와 roadmap 수용 기준에 반복/비활성/다시 알림을 기록한다.

- [ ] **Step 2: 집중 회귀 검사**

Run:

```bash
bun run --cwd packages/shared test
bun run --cwd apps/api test src/__tests__/image-processing.test.ts src/__tests__/reminder-recurrence.test.ts src/__tests__/reminders-routes.test.ts src/__tests__/reminder-cron.test.ts
bun run --cwd apps/web test src/routes/_authed/-index.test.tsx src/routes/_authed/-settings.test.tsx src/routes/_authed/-reminder-dialog.test.tsx src/routes/_authed/-reminders.test.tsx
```

Expected: 전부 PASS.

- [ ] **Step 3: 전체 검증 루프**

Run: `bun run typecheck && bun run lint && bun run test && bun run build`

Expected: 네 명령 모두 exit 0. 실패하면 원인을 수정하고 전체 루프를 다시 실행한다.

- [ ] **Step 4: linked migration dry-run 및 적용**

Run: `bun x supabase db push --linked --dry-run`

Expected: 새 reminder recurrence migration 하나만 pending.

Run: `bun x supabase db push --linked --yes`

Expected: migration 적용 성공.

Run: `bun x supabase migration list --linked && bun x supabase db lint --linked`

Expected: local/remote migration 일치, `No schema errors found`.

- [ ] **Step 5: PROGRESS 기록과 최종 커밋**

검증 수치, sRGB 적용 범위가 신규 파생본부터라는 점, 반복 상태 전이, 원격 migration 결과와 남은 실제 알림 수신 확인을 기록한다.

```bash
git add docs/02-database.md docs/03-api.md docs/06-pwa-push.md docs/09-roadmap.md PROGRESS.md
git commit -m "docs: 반복 리마인더 구현과 검증 결과 기록"
```

- [ ] **Step 6: 최종 diff 자체 리뷰**

Run: `git status --short && git diff HEAD~6 --check && git diff HEAD~6 --stat`

Expected: 사용자 소유 `.env.example`, `docker-compose.yml` 외 작업 파일이 모두 커밋됐고 whitespace 오류가 없음.
