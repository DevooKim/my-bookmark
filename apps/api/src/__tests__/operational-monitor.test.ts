import { describe, expect, it, vi } from "vitest";
import type { AlertDispatcher } from "../services/alerting";
import { createOperationalMonitor } from "../services/operational-monitor";
import { createReadinessService } from "../services/readiness";

function setup() {
  let now = new Date("2026-07-19T12:00:00.000Z");
  const alerts: AlertDispatcher = {
    notify: vi.fn().mockResolvedValue(undefined),
  };
  const readiness = createReadinessService({
    databaseCheck: vi.fn().mockResolvedValue(undefined),
    now: () => now,
  });
  readiness.setPushConfigured(true);
  readiness.markCronStarted(now);
  const monitor = createOperationalMonitor({
    alerts,
    readiness,
    now: () => now,
  });
  return { alerts, readiness, monitor, setNow: (value: Date) => (now = value) };
}

const failedAi = {
  provider: "openrouter",
  model: "@preset/my-bookmark",
  bookmarkId: null,
  status: "failed" as const,
  errorCode: "429",
  durationMs: 10,
  isByok: null,
};

describe("operational monitor", () => {
  it("alerts after three consecutive AI failures", async () => {
    const { alerts, monitor } = setup();
    monitor.recordAiUsage(failedAi);
    monitor.recordAiUsage(failedAi);
    monitor.recordAiUsage(failedAi);

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "ai:consecutive-failures",
        count: 3,
      }),
    );
  });

  it("alerts once on cron failure and once on recovery", async () => {
    const { alerts, monitor } = setup();
    monitor.recordCronFailure(new Error("database secret"));
    monitor.recordCronFailure(new Error("database secret"));
    monitor.recordCronSuccess({
      scanned: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      expired: 0,
    });

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(alerts.notify).mock.calls)).not.toContain(
      "database secret",
    );
  });

  it("warns after the reminder scan limit is full three times", async () => {
    const { alerts, monitor } = setup();
    const result = { scanned: 20, claimed: 0, sent: 0, failed: 0, expired: 0 };
    monitor.recordCronSuccess(result);
    monitor.recordCronSuccess(result);
    monitor.recordCronSuccess(result);

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: "reminder:backlog" }),
    );
  });
});
