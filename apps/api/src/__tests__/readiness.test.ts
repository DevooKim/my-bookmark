import { describe, expect, it, vi } from "vitest";
import { createReadinessService } from "../services/readiness";

describe("readiness", () => {
  it("reports database, push, and cron healthy", async () => {
    const service = createReadinessService({
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      now: () => new Date("2026-07-19T12:01:00.000Z"),
    });
    service.setPushConfigured(true);
    service.markCronStarted(new Date("2026-07-19T12:00:00.000Z"));
    service.markCronSuccess(new Date("2026-07-19T12:01:00.000Z"));

    await expect(service.check()).resolves.toEqual({
      ok: true,
      checks: { database: "ok", push: "ok", reminderCron: "ok" },
    });
  });

  it("returns only redacted failed states", async () => {
    const service = createReadinessService({
      databaseCheck: vi.fn().mockRejectedValue(new Error("secret DB URL")),
    });

    const result = await service.check();

    expect(result).toEqual({
      ok: false,
      checks: { database: "failed", push: "failed", reminderCron: "failed" },
    });
    expect(JSON.stringify(result)).not.toContain("secret DB URL");
  });

  it("marks cron stale three minutes after its last success", async () => {
    let now = new Date("2026-07-19T12:00:00.000Z");
    const service = createReadinessService({
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      now: () => now,
    });
    service.setPushConfigured(true);
    service.markCronStarted(now);
    service.markCronSuccess(now);
    now = new Date("2026-07-19T12:03:01.000Z");

    expect((await service.check()).checks.reminderCron).toBe("failed");
  });
});
