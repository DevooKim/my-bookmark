import { describe, expect, it, vi } from "vitest";
import {
  type AlertEvent,
  buildDiscordPayload,
  createDeduplicatingDispatcher,
  createDiscordAlertSink,
} from "../services/alerting";

const event: AlertEvent = {
  fingerprint: "security:authentication:100.87.42.16",
  severity: "warning",
  title: "반복 인증 실패",
  component: "authentication",
  summary: "인증 실패 임계치 초과",
  occurredAt: new Date("2026-07-19T12:00:00.000Z"),
  sourceIp: "100.87.42.16",
  method: "GET",
  path: "/api/bookmarks",
  status: 401,
  count: 5,
  windowLabel: "1분",
};

describe("Discord alerting", () => {
  it("formats only allowlisted alert fields", () => {
    const payload = buildDiscordPayload(
      {
        ...event,
        authorization: "Bearer secret-token",
        apiKey: "bm_secret",
        cookie: "session=secret",
        body: "private body",
      } as AlertEvent,
      "home-production",
    );
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("100.87.42.16");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("bm_secret");
    expect(serialized).not.toContain("private body");
  });

  it("retries one 5xx response and succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sink = createDiscordAlertSink({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      alertEnvironment: "home-production",
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await sink(event);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("suppresses duplicates and reports their count after cooldown", async () => {
    let now = new Date("2026-07-19T12:00:00.000Z");
    const send = vi.fn().mockResolvedValue(undefined);
    const dispatcher = createDeduplicatingDispatcher({
      send,
      now: () => now,
    });

    await dispatcher.notify(event);
    await dispatcher.notify(event);
    now = new Date("2026-07-19T12:10:01.000Z");
    await dispatcher.notify(event);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 6 }),
    );
  });

  it("does not start cooldown after delivery failure", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const onDeliveryError = vi.fn();
    const dispatcher = createDeduplicatingDispatcher({ send, onDeliveryError });

    await dispatcher.notify(event);
    await dispatcher.notify(event);

    expect(send).toHaveBeenCalledTimes(2);
    expect(onDeliveryError).toHaveBeenCalledOnce();
  });
});
