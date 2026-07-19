# Discord Monitoring and Abnormal Access Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord alerts for service outages, operational failures, and abnormal API access while Uptime Kuma monitors the Caddy-routed home-production stack.

**Architecture:** Uptime Kuma runs beside web and API in Docker Compose and owns HTTP availability transitions. The Express API owns a small alerting core, in-memory deduplication and sliding-window counters, readiness state, and instrumentation for authentication failures, suspicious requests, cron, Push, AI, and unexpected server errors. Discord is always best-effort and never changes the result of the application work that triggered an alert.

**Tech Stack:** Express 5, TypeScript 7.0.2, Vitest/Supertest, native `fetch`, pino, Docker Compose, Caddy, Uptime Kuma 2.4.0, Discord Webhooks

---

## File map

- Create `apps/api/src/services/alerting.ts`: safe alert contract, Discord payload formatting and delivery, retry, and 10-minute deduplication.
- Create `apps/api/src/services/sliding-window.ts`: reusable in-memory keyed event counter.
- Create `apps/api/src/middleware/security-monitor.ts`: IP-based abnormal-access classification and thresholds.
- Create `apps/api/src/services/readiness.ts`: database, Push, and reminder-cron readiness state.
- Create `apps/api/src/services/operational-monitor.ts`: AI, Push, backlog, cron failure/recovery, and unexpected-error alert policy.
- Create `apps/api/src/__tests__/alerting.test.ts`: Discord safety, retry, timeout, and deduplication tests.
- Create `apps/api/src/__tests__/security-monitor.test.ts`: one-minute authentication and other abnormal-access thresholds.
- Create `apps/api/src/__tests__/readiness.test.ts`: dependency-state and redacted readiness response tests.
- Create `apps/api/src/__tests__/operational-monitor.test.ts`: domain threshold and recovery tests.
- Create `apps/api/src/__tests__/monitoring-compose.test.ts`: Compose version, volume, loopback binding, and no-Docker-socket regression.
- Modify `apps/api/src/lib/env.ts` and `apps/api/src/__tests__/env.test.ts`: parse server-only Discord alert settings.
- Modify `apps/api/src/app.ts`: dependency injection, security middleware ordering, rate-limit observation, and API 404 boundary.
- Modify `apps/api/src/routes/health.ts` and `apps/api/src/__tests__/health.test.ts`: add `/api/health/ready`.
- Modify `apps/api/src/middleware/error.ts`: retain the existing export and add injectable unexpected-error reporting.
- Modify `apps/api/src/services/ai-usage.ts` and its test: feed successful/failed AI events to the operational monitor.
- Modify `apps/api/src/routes/bookmarks.ts`: pass the one production operational monitor into AI usage recording.
- Modify `apps/api/src/services/reminder-cron.ts` and its test: report cron results, backlog, all/partial Push failure, failure, and recovery.
- Modify `apps/api/src/index.ts`: compose alerting/readiness/monitoring once and update lifecycle state.
- Modify `.env.example`: document `DISCORD_ALERT_WEBHOOK_URL` and `ALERT_ENV`.
- Modify `docker-compose.yml`: add Uptime Kuma 2.4.0, persistent local volume, and loopback-only service ports.
- Modify `docs/01-architecture.md` and `docs/deploy.md`: document monitoring boundaries, Caddy/Tailscale setup, Kuma monitors, Discord, and drill procedures.
- Modify `PROGRESS.md`: record decisions, completed verification, and remaining home-server manual checks.

### Task 1: Build the safe Discord alerting core

**Files:**
- Create: `apps/api/src/services/alerting.ts`
- Create: `apps/api/src/__tests__/alerting.test.ts`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/__tests__/env.test.ts`

- [ ] **Step 1: Write failing environment and payload tests**

Add env assertions:

```ts
it("parses optional server-only Discord alert settings", () => {
  const env = parseEnv({
    NODE_ENV: "test",
    DISCORD_ALERT_WEBHOOK_URL:
      "https://discord.com/api/webhooks/123/example-token",
    ALERT_ENV: "home-production",
  });

  expect(env.DISCORD_ALERT_WEBHOOK_URL).toBe(
    "https://discord.com/api/webhooks/123/example-token",
  );
  expect(env.ALERT_ENV).toBe("home-production");
});
```

Create `alerting.test.ts` with an event containing only the approved safe fields and assert the generated Discord body contains the source IP but not an injected bearer token, API key, cookie, query, body, bookmark URL, or raw error value.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun run --cwd apps/api test -- env.test.ts alerting.test.ts
```

Expected: FAIL because the env fields and `alerting.ts` do not exist.

- [ ] **Step 3: Add the alert contract and allowlisted Discord formatter**

Use this public boundary:

```ts
export type AlertSeverity = "critical" | "warning" | "recovered";

export interface AlertEvent {
  fingerprint: string;
  severity: AlertSeverity;
  title: string;
  component: string;
  summary: string;
  occurredAt: Date;
  sourceIp?: string;
  method?: string;
  path?: string;
  status?: number;
  count?: number;
  windowLabel?: string;
  requestId?: string;
}

export interface AlertDispatcher {
  notify(event: AlertEvent): Promise<void>;
}
```

`buildDiscordPayload(event, alertEnvironment)` must construct one embed from only these explicit properties. It must not accept an arbitrary `fields` object or raw `Error`, request headers, request body, URL query, bookmark data, or AI output. Use red/yellow/green embed colors and format the visible timestamp in `Asia/Seoul`; retain the embed timestamp as UTC ISO.

- [ ] **Step 4: Implement best-effort delivery with bounded retry**

Create an injectable Discord sink:

```ts
export function createDiscordAlertSink(options: {
  webhookUrl?: string;
  alertEnvironment: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}): (event: AlertEvent) => Promise<void>;
```

Behavior:

- no Webhook URL: no network request and resolve successfully;
- request timeout: 3 seconds through `AbortSignal.timeout`;
- retry exactly once for HTTP 429 or 5xx;
- use `Retry-After` for 429, capped at 3 seconds; use 250ms for 5xx;
- do not retry other 4xx;
- throw one sanitized `DiscordAlertDeliveryError` after the final failure; do not retain response bodies or the Webhook URL in the error.

- [ ] **Step 5: Implement 10-minute in-memory deduplication**

Expose:

```ts
export function createDeduplicatingDispatcher(options: {
  send: (event: AlertEvent) => Promise<void>;
  now?: () => Date;
  cooldownMs?: number;
  onDeliveryError?: (error: unknown) => void;
}): AlertDispatcher;
```

The first alert sends immediately. Repeated fingerprints inside 10 minutes increment a suppressed counter. The first occurrence after cooldown sends once with `count` equal to the current occurrence plus suppressed occurrences. Update cooldown state only after a successful delivery, so a Discord failure does not silence the next occurrence. Delivery failures call `onDeliveryError` and resolve; callers never receive a rejection that can fail API or cron work. Opportunistically remove fingerprints older than two cooldown windows so one-off errors cannot grow the Map forever.

Export one `defaultAlertDispatcher` composed from `appEnv.DISCORD_ALERT_WEBHOOK_URL`, `appEnv.ALERT_ENV`, the Discord sink, and the deduplicating dispatcher. Tests use injected dispatchers and never call the real Webhook.

- [ ] **Step 6: Add the env schema**

Add:

```ts
DISCORD_ALERT_WEBHOOK_URL: z.url().optional(),
ALERT_ENV: z.string().min(1).default("home-production"),
```

Keep the Webhook optional so test and local development remain usable. Production setup and the manual drill will verify it is configured.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
bun run --cwd apps/api test -- env.test.ts alerting.test.ts
bun run --cwd apps/api typecheck
```

Expected: all selected tests and API typecheck pass.

```bash
git add apps/api/src/services/alerting.ts apps/api/src/__tests__/alerting.test.ts apps/api/src/lib/env.ts apps/api/src/__tests__/env.test.ts
git commit -m "feat: Discord 알림 전송 기반 추가"
```

### Task 2: Detect abnormal API access without blocking clients

**Files:**
- Create: `apps/api/src/services/sliding-window.ts`
- Create: `apps/api/src/middleware/security-monitor.ts`
- Create: `apps/api/src/__tests__/security-monitor.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/__tests__/app-auth-order.test.ts`

- [ ] **Step 1: Write failing counter and middleware tests**

Use a fake clock and injected `AlertDispatcher`. Lock these cases:

```ts
expect(alerts.notify).toHaveBeenCalledWith(
  expect.objectContaining({
    fingerprint: "security:authentication:100.87.42.16",
    sourceIp: "100.87.42.16",
    count: 5,
    windowLabel: "1분",
  }),
);
```

Cover:

- same IP: no alert for four 401 responses, one alert on the fifth inside 60 seconds;
- different IPs never combine their counters;
- a fifth authentication failure after the first event has aged beyond 60 seconds does not alert;
- `/api/.env`, `/api/.git/config`, `/api/wp-admin`, encoded `..` traversal alert immediately;
- 404/405 alerts on 20 events in five minutes;
- 413 or JSON/multipart parser errors alert on five events in ten minutes;
- 429 alerts on 20 events in ten minutes;
- events never cause 403, ban an IP, or mutate Caddy/firewall state.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun run --cwd apps/api test -- security-monitor.test.ts app-auth-order.test.ts
```

Expected: FAIL because the counter and security middleware do not exist.

- [ ] **Step 3: Implement the keyed sliding window**

Use this focused API:

```ts
export function createSlidingWindowCounter(options: {
  windowMs: number;
  threshold: number;
  now?: () => number;
}) {
  return {
    record(key: string): { crossed: boolean; count: number };
    clear(key: string): void;
  };
}
```

Store only timestamps per key, discard entries older than `now - windowMs` on every record, and return `crossed: true` only when the count first equals the threshold. Bound memory by removing empty keys during pruning. The alert dispatcher owns later 10-minute duplicate suppression.

- [ ] **Step 4: Implement request classification**

Expose:

```ts
export function createSecurityMonitor(options: {
  alerts: AlertDispatcher;
  now?: () => Date;
}): {
  middleware: RequestHandler;
  markMalformed(response: Response): void;
};
```

Register the `finish` listener before body parsing. Classify from `request.ip`, method, a query-free normalized pathname, response status, and private `response.locals.securityMalformed` / `response.locals.securityRouteNotFound` markers. Count 404 only when the terminal API fallback set the route-not-found marker, not when a valid resource route returned `Bookmark not found` or an equivalent domain 404. Never read or store header values; checking whether `Authorization` or `X-API-Key` exists is allowed only to label authentication type, not to include its contents.

Use explicit counters:

```ts
const authFailures = createSlidingWindowCounter({
  windowMs: 60_000,
  threshold: 5,
  now: nowMilliseconds,
});
const notFoundOrMethod = createSlidingWindowCounter({
  windowMs: 5 * 60_000,
  threshold: 20,
  now: nowMilliseconds,
});
const malformed = createSlidingWindowCounter({
  windowMs: 10 * 60_000,
  threshold: 5,
  now: nowMilliseconds,
});
const rateLimited = createSlidingWindowCounter({
  windowMs: 10 * 60_000,
  threshold: 20,
  now: nowMilliseconds,
});
```

Sensitive-path matching is immediate and limited to the API request surface that reaches Express. Root-level web/Caddy scanning and Caddy log ingestion remain outside this implementation, matching the design's no-log-platform boundary.

- [ ] **Step 5: Mount monitoring before parsers and add a common API 404**

Extend `createApp` with optional injected dependencies while preserving existing zero-argument calls:

```ts
export interface CreateAppOptions {
  alerts?: AlertDispatcher;
  securityMonitor?: ReturnType<typeof createSecurityMonitor>;
}

export function createApp(options: CreateAppOptions = {}): express.Express;
```

Order middleware as helmet → compression → CORS → pino → security monitor → `express.json()` → rate limit → routers → `/api` JSON 404 → error middleware. Keep the current rate-limit handler unchanged so the security monitor observes the final 429 without altering enforcement.

The API 404 response is:

```ts
response.status(404).json({
  error: { code: API_ERROR_CODES.NOT_FOUND, message: "Route not found" },
});
```

Set `response.locals.securityRouteNotFound = true` immediately before this response. If a future route explicitly returns 405, observe that status directly; do not add a guessed route table only to synthesize 405 responses in this task.

- [ ] **Step 6: Verify thresholds and existing auth behavior**

Run:

```bash
bun run --cwd apps/api test -- security-monitor.test.ts app-auth-order.test.ts auth.test.ts logging.test.ts
```

Expected: security thresholds pass; existing auth ordering, common 429 format, and header redaction remain unchanged.

- [ ] **Step 7: Commit abnormal-access monitoring**

```bash
git add apps/api/src/services/sliding-window.ts apps/api/src/middleware/security-monitor.ts apps/api/src/__tests__/security-monitor.test.ts apps/api/src/app.ts apps/api/src/__tests__/app-auth-order.test.ts
git commit -m "feat: 비정상 API 접근 감지 추가"
```

### Task 3: Add dependency-aware readiness

**Files:**
- Create: `apps/api/src/services/readiness.ts`
- Create: `apps/api/src/__tests__/readiness.test.ts`
- Modify: `apps/api/src/routes/health.ts`
- Modify: `apps/api/src/__tests__/health.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing readiness tests**

Cover:

- all checks healthy → `200` with the exact approved JSON;
- DB check throws → `503`, `ok: false`, `database: "failed"`;
- Push not configured → `503`, `push: "failed"`;
- cron not started or its last successful run is older than three minutes → `503`, `reminderCron: "failed"`;
- no response contains Supabase URL, keys, Webhook URL, thrown message, or stack.

Expected healthy body:

```ts
expect(response.body).toEqual({
  ok: true,
  checks: {
    database: "ok",
    push: "ok",
    reminderCron: "ok",
  },
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bun run --cwd apps/api test -- readiness.test.ts health.test.ts
```

Expected: FAIL because `/api/health/ready` and readiness state do not exist.

- [ ] **Step 3: Implement readiness state**

Expose:

```ts
export interface ReadinessSnapshot {
  ok: boolean;
  checks: {
    database: "ok" | "failed";
    push: "ok" | "failed";
    reminderCron: "ok" | "failed";
  };
}

export interface ReadinessService {
  check(): Promise<ReadinessSnapshot>;
  setPushConfigured(configured: boolean): void;
  markCronStarted(startedAt?: Date): void;
  markCronSuccess(at?: Date): void;
  markCronFailure(at?: Date): void;
  markCronStopped(): void;
}
```

`createReadinessService({ databaseCheck, now })` runs a minimal Supabase query through an injected dependency. Cron is healthy immediately after scheduling and becomes stale when no successful run has occurred for three minutes; a recorded failure makes it failed until the next success. VAPID completeness supplies the Push state.

Export one `defaultReadinessService` using a minimal `supabaseAdmin.from("bookmarks").select("id").limit(1)` check. The route and startup composition share this instance; tests inject a fake database check.

- [ ] **Step 4: Add an injectable health router**

Keep `GET /health` byte-for-byte unchanged and add:

```ts
router.get("/health/ready", async (_request, response) => {
  const snapshot = await readiness.check();
  response.status(snapshot.ok ? 200 : 503).json(snapshot);
});
```

Export `createHealthRouter({ readiness })` for app composition. Retain a default `healthRouter` only if existing direct imports require it; do not expose error details.

At this task, extend the existing `CreateAppOptions` with `readiness?: ReadinessService` and mount `createHealthRouter({ readiness })`. This keeps Task 2 independently type-correct before the readiness module exists.

- [ ] **Step 5: Compose startup state**

In `index.ts`, create readiness before the app, set Push state from `configureWebPush()`, mark cron started only when `startReminderCron` returns a task, and mark it stopped during SIGTERM/SIGINT shutdown. Do not mark readiness based only on the Docker container state.

- [ ] **Step 6: Verify readiness and commit**

Run:

```bash
bun run --cwd apps/api test -- readiness.test.ts health.test.ts reminder-cron.test.ts
bun run --cwd apps/api typecheck
```

Expected: focused tests and typecheck pass.

```bash
git add apps/api/src/services/readiness.ts apps/api/src/__tests__/readiness.test.ts apps/api/src/routes/health.ts apps/api/src/__tests__/health.test.ts apps/api/src/app.ts apps/api/src/index.ts
git commit -m "feat: API readiness 상태 확인 추가"
```

### Task 4: Instrument operational failures and recovery

**Files:**
- Create: `apps/api/src/services/operational-monitor.ts`
- Create: `apps/api/src/__tests__/operational-monitor.test.ts`
- Modify: `apps/api/src/middleware/error.ts`
- Modify: `apps/api/src/services/ai-usage.ts`
- Modify: `apps/api/src/__tests__/ai-usage.test.ts`
- Modify: `apps/api/src/services/reminder-cron.ts`
- Modify: `apps/api/src/__tests__/reminder-cron.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing policy tests**

Lock these transitions with a fake clock and dispatcher:

- AI: warning on three consecutive failures inside 15 minutes;
- AI: warning on five total failures inside 15 minutes even when successes interrupt the consecutive count;
- AI success resets only the consecutive counter;
- cron exception alerts once and marks readiness failed;
- next cron success sends one recovered alert and marks readiness healthy;
- `scanned === 20` for three consecutive runs sends backlog warning; a smaller scan resets the consecutive count;
- claimed reminder with `sent === 0`, `failed > 0`, and no only-expired result sends immediate Warning;
- mixed Push success/failure is accumulated and sent at the 15-minute threshold;
- expired 404/410 subscriptions never contribute to failure alerts;
- unexpected 500/502 reports a sanitized event, while Zod, Multer validation, 401, 404, 409, and ordinary 429 do not call the operational dispatcher.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun run --cwd apps/api test -- operational-monitor.test.ts ai-usage.test.ts reminder-cron.test.ts
```

Expected: FAIL because the operational monitor hooks do not exist.

- [ ] **Step 3: Implement the operational policy facade**

Use this explicit boundary:

```ts
export interface OperationalMonitor {
  recordAiUsage(event: AiUsageEventInput): void;
  recordReminderRun(result: ReminderRunResult): void;
  recordCronFailure(error: unknown): void;
  recordCronSuccess(result: ReminderRunResult): void;
  recordUnexpectedHttpError(input: {
    status: number;
    method: string;
    path: string;
    requestId?: string;
  }): void;
}
```

Compose it from `AlertDispatcher`, `ReadinessService`, the keyed sliding-window utility, and a fakeable clock. Normalize fingerprints and summaries inside this module; never pass raw `Error` content to `AlertEvent`.

Export exactly one production `defaultOperationalMonitor` backed by `defaultAlertDispatcher` and `defaultReadinessService`. The app and cron accept injected instances for tests, while `categorizeBookmarkForUser` uses this default unless a test supplies another monitor. This prevents separate route and cron counters.

Define the reminder run result once and extend existing results with expired cleanup:

```ts
export interface ReminderRunResult {
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  expired: number;
}
```

- [ ] **Step 4: Wire AI usage without changing categorization outcome**

Extend the recorder factory compatibly:

```ts
export function createAiUsageRecorder(
  db: unknown,
  userId: string,
  onEvent: (event: AiUsageEventInput) => void = () => undefined,
)
```

Call `onEvent(event)` before the best-effort DB insert. The callback must be synchronous and non-throwing; wrap it defensively so monitoring never breaks categorization. Pass `operationalMonitor.recordAiUsage` from the production bookmark categorization composition.

Extend `categorizeBookmarkForUser` in `routes/bookmarks.ts` with an injectable `usageMonitor` option defaulting to `defaultOperationalMonitor`, then create the recorder as:

```ts
recordUsage: createAiUsageRecorder(
  db,
  userId,
  (event) => usageMonitor.recordAiUsage(event),
),
```

This single boundary covers link and image categorization because both already delegate to `categorizeBookmarkForUser`.

- [ ] **Step 5: Wire reminder results, cron failure, and recovery**

Extend `startReminderCron` with an optional injected monitor:

```ts
export function startReminderCron({
  pushConfigured,
  schedule = cron.schedule,
  monitor,
}: {
  pushConfigured: boolean;
  schedule?: typeof cron.schedule;
  monitor?: Pick<
    OperationalMonitor,
    "recordCronFailure" | "recordCronSuccess"
  >;
}): ScheduledTask | null;
```

Await `processDueReminders` inside the scheduled async callback, send the result to `recordCronSuccess`, and pass caught exceptions to `recordCronFailure` before the existing warning log. Count `expired` separately in `processDueReminders`; do not turn expired cleanup into `failed`.

- [ ] **Step 6: Add injectable error reporting while preserving test helpers**

Keep the existing `errorMiddleware` export for route tests and add:

```ts
export function createErrorMiddleware(options: {
  operationalMonitor: OperationalMonitor;
  securityMonitor: ReturnType<typeof createSecurityMonitor>;
}): ErrorRequestHandler;
```

The factory preserves every existing response shape. It marks JSON parser and multipart parser errors for the security monitor, and reports only unexpected 500 errors plus server-side 502 dependency failures. Report method and query-free path, never raw errors or request data. Log the real error to pino with the existing redaction policy, but do not serialize request headers or bodies into that error record.

- [ ] **Step 7: Compose one production monitor graph**

In `index.ts`, import the production `defaultAlertDispatcher`, `defaultReadinessService`, and `defaultOperationalMonitor`, create one security monitor from that dispatcher, and pass the same instances into `createApp` and `startReminderCron`. Do not create per-request monitors or per-router counters.

- [ ] **Step 8: Verify focused regressions and commit**

Run:

```bash
bun run --cwd apps/api test -- operational-monitor.test.ts ai-usage.test.ts categorize.test.ts reminder-cron.test.ts push-sender.test.ts health.test.ts auth.test.ts logging.test.ts
bun run --cwd apps/api typecheck
```

Expected: all focused tests pass and existing API response contracts are unchanged.

```bash
git add apps/api/src/services/operational-monitor.ts apps/api/src/__tests__/operational-monitor.test.ts apps/api/src/middleware/error.ts apps/api/src/services/ai-usage.ts apps/api/src/__tests__/ai-usage.test.ts apps/api/src/services/reminder-cron.ts apps/api/src/__tests__/reminder-cron.test.ts apps/api/src/routes/bookmarks.ts apps/api/src/app.ts apps/api/src/index.ts
git commit -m "feat: 운영 장애 Discord 알림 연결"
```

### Task 5: Add Uptime Kuma and harden the Compose exposure boundary

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docs/deploy.md`

- [ ] **Step 1: Add a Compose regression test before changing YAML**

Create an executable configuration assertion in the existing API test suite or a focused root script that reads `docker-compose.yml` as text and locks these exact invariants:

```ts
expect(compose).toContain("louislam/uptime-kuma:2.4.0");
expect(compose).toContain("uptime-kuma-data:/app/data");
expect(compose).toContain('127.0.0.1:3001:3001');
expect(compose).toContain('127.0.0.1:3000:3000');
expect(compose).not.toContain("/var/run/docker.sock");
```

Use a new file `apps/api/src/__tests__/monitoring-compose.test.ts`. Resolve the repository root from `import.meta.url` in the same lint-compliant style as existing manifest/config regression tests.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun run --cwd apps/api test -- monitoring-compose.test.ts
```

Expected: FAIL because Kuma and loopback-only bindings are absent.

- [ ] **Step 3: Modify Compose**

Use this service and volume:

```yaml
  uptime-kuma:
    image: louislam/uptime-kuma:2.4.0
    ports:
      - "127.0.0.1:3002:3001"
    volumes:
      - uptime-kuma-data:/app/data
    restart: unless-stopped

volumes:
  uptime-kuma-data:
```

Change API and web published ports to `127.0.0.1:3001:3001` and `127.0.0.1:3000:3000`. Do not mount the Docker socket and do not grant privileged capabilities. Keep existing container healthchecks unchanged.

- [ ] **Step 4: Document required env and host-level Caddy action**

Add to `.env.example`:

```dotenv
# 서버 전용 Discord Webhook. web에 노출하지 않는다.
DISCORD_ALERT_WEBHOOK_URL=
ALERT_ENV=home-production
TRUST_PROXY=1
```

In `docs/deploy.md`, state that the current host-level Caddy configuration must reverse proxy a Tailscale-only Kuma hostname to `127.0.0.1:3002`. The Caddyfile lives outside this repository, so do not invent or overwrite its path. Require verification that the hostname is unreachable outside the Tailnet.

- [ ] **Step 5: Validate Compose and the regression test**

Run:

```bash
bun run --cwd apps/api test -- monitoring-compose.test.ts
docker compose config --quiet
```

Expected: test passes and Compose config exits 0. If the home Caddy itself runs in a container rather than on the host, stop before deployment and attach Caddy and services to one Docker network instead of exposing ports beyond loopback.

- [ ] **Step 6: Commit Compose monitoring**

```bash
git add .env.example docker-compose.yml docs/deploy.md apps/api/src/__tests__/monitoring-compose.test.ts
git commit -m "feat: Uptime Kuma 운영 구성 추가"
```

### Task 6: Complete documentation, full verification, and home-server drill

**Files:**
- Modify: `docs/01-architecture.md`
- Modify: `docs/deploy.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Document the final monitoring contract**

Add the approved thresholds and responsibility boundary to the docs:

```text
Kuma: Caddy 경유 web/API/readiness Down과 Up
API: 1분 내 동일 IP 인증 실패 5회, 민감 API 경로 즉시,
     404/405 5분 20회, parser/413 10분 5회, 429 10분 20회,
     cron/Push/AI/500·502 운영 오류
대응: 전체 IP 표시, 자동 차단 없음, 필요 시 Tailscale에서 수동 제거
```

Document that same-host Kuma cannot report power, Docker daemon, internet, or whole-Tailscale outages.

- [ ] **Step 2: Document exact Kuma UI settings**

Create these monitors through the Tailscale-only Kuma UI:

```text
[home-prod] web           /login              60s, Retries 2
[home-prod] api           /api/health         30s, Retries 2
[home-prod] api-readiness /api/health/ready   60s, Retries 2
```

Attach the private Discord notification to all three. Enable Down and Up messages and disable periodic normal heartbeat messages. Do not enable a public status page.

- [ ] **Step 3: Run the entire repository verification loop**

Run:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
docker compose config --quiet
```

Expected: all commands exit 0. The existing seed-script Biome literal-key notice may remain informational; do not weaken lint rules or skip failing tests.

- [ ] **Step 4: Build and start the production stack**

Run on the home server with the real `.env` already containing the private Webhook URL:

```bash
docker compose build api web
docker compose pull uptime-kuma
docker compose up -d
docker compose ps
```

Expected: api and web are healthy, Kuma is running, and no secret appears in `docker compose logs api`.

- [ ] **Step 5: Perform the approved alert drill**

Verify in order:

1. stop web, wait for Down, start web, confirm Up;
2. stop API, wait for Down, start API, confirm Up;
3. force one readiness dependency failure and restore it;
4. send five invalid authenticated API requests from one Tailnet device inside one minute and confirm one Warning containing its full Tailscale IP;
5. request `/api/.env` and confirm immediate Warning;
6. temporarily set an invalid Discord Webhook for the API, trigger a test error, and confirm the app request/cron behavior remains intact;
7. inspect Discord and pino output for absence of tokens, API keys, cookies, request bodies, queries, bookmark content, and AI output;
8. confirm no request was automatically blocked;
9. confirm Kuma UI is unreachable outside Tailscale.

- [ ] **Step 6: Update progress and record concrete evidence**

Update `PROGRESS.md` with:

- the new monitoring follow-up checklist item;
- automatic blocking explicitly excluded;
- authentication threshold `same IP / 1 minute / 5 failures`;
- exact automated test totals and full verification results;
- Compose container health and the Discord drill result;
- any manual home-Caddy action that remains.

- [ ] **Step 7: Inspect final scope and commit**

Run:

```bash
git diff --check
git status --short
git log --oneline -6
```

Expected: only the intended documentation/progress files remain, no `.env`, Webhook URL, key, token, or Kuma data file is tracked.

```bash
git add docs/01-architecture.md docs/deploy.md PROGRESS.md
git commit -m "docs: Discord 모니터링 운영 절차 기록"
```

## Final acceptance checklist

- Uptime Kuma reports Caddy-routed web, API liveness, and API readiness Down/Up transitions to Discord.
- The API reports cron, Push, AI, unexpected 500/502, and backlog thresholds without changing business outcomes.
- Five authentication failures from the same full IP inside one minute produce one warning; IPs are never combined.
- Sensitive API path probes and the approved 404/405, parser/413, and 429 thresholds produce warnings.
- Ten-minute deduplication and recovery behavior are deterministic under fake-clock tests.
- No automatic IP ban, firewall mutation, Docker socket mount, public Kuma UI, or long-term event store is added.
- Discord payloads contain the full source IP when applicable but no credential, request body/query, bookmark content, AI output, or raw external error.
- Discord failure never fails API, cron, Push, or AI work.
- Full repository verification and the home-server alert drill pass before the feature is marked complete.
