import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAiUsageRecorder,
  fetchAccountUsage,
  fetchAnalytics,
  listAiUsageEvents,
} from "../services/ai-usage";

const userId = "11111111-1111-4111-8111-111111111111";

describe("ai usage recorder", () => {
  it("reports an event to monitoring before persisting it", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };
    const onEvent = vi.fn();
    const record = createAiUsageRecorder(db, userId, onEvent);
    const event = {
      provider: "openrouter",
      model: "@preset/my-bookmark",
      bookmarkId: null,
      status: "failed" as const,
      errorCode: "429",
      durationMs: 10,
      isByok: null,
    };

    await record(event);

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("inserts one row per attempt", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const db = { from: vi.fn(() => ({ insert })) };
    const record = createAiUsageRecorder(db, userId);

    await record({
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      bookmarkId: "22222222-2222-4222-8222-222222222222",
      status: "failed",
      errorCode: "429",
      durationMs: 1200,
      isByok: null,
    });

    expect(db.from).toHaveBeenCalledWith("ai_usage_events");
    expect(insert).toHaveBeenCalledWith({
      user_id: userId,
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      bookmark_id: "22222222-2222-4222-8222-222222222222",
      status: "failed",
      error_code: "429",
      duration_ms: 1200,
      is_byok: null,
    });
  });

  it("never throws even when the insert fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const insert = vi.fn().mockRejectedValue(new Error("db down"));
    const db = { from: vi.fn(() => ({ insert })) };
    const record = createAiUsageRecorder(db, userId);

    await expect(
      record({
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        bookmarkId: null,
        status: "success",
        errorCode: null,
        durationMs: 800,
        isByok: true,
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("listAiUsageEvents", () => {
  it("queries the user window ordered by created_at desc with a cap", async () => {
    const rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        user_id: userId,
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        bookmark_id: null,
        status: "success",
        error_code: null,
        duration_ms: 700,
        is_byok: true,
        created_at: "2026-07-12T10:00:00.000Z",
      },
    ];
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
    const order = vi.fn(() => ({ limit }));
    const gte = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ gte }));
    const select = vi.fn(() => ({ eq }));
    const db = { from: vi.fn(() => ({ select })) };

    const items = await listAiUsageEvents(db, userId, 30);

    expect(limit).toHaveBeenCalledWith(1000);
    expect(items[0]).toMatchObject({
      model: "gemini-flash-lite-latest",
      status: "success",
      durationMs: 700,
      isByok: true,
    });
  });
});

describe("fetchAccountUsage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the OpenRouter /key response to camelCase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              usage: 1.2,
              usage_daily: 0.1,
              usage_weekly: 0.5,
              usage_monthly: 1.2,
              limit: 10,
              limit_remaining: 8.8,
              is_free_tier: false,
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchAccountUsage("or-key")).resolves.toEqual({
      usage: 1.2,
      usageDaily: 0.1,
      usageWeekly: 0.5,
      usageMonthly: 1.2,
      limit: 10,
      limitRemaining: 8.8,
      isFreeTier: false,
    });
  });

  it("throws a 502 HttpError when the key lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );

    await expect(fetchAccountUsage("bad-key")).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("fetchAnalytics", () => {
  it("throws a 502 when the analytics query fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 403 })),
    );

    await expect(fetchAnalytics("or-mgmt-key", 7)).rejects.toMatchObject({
      status: 502,
    });
    vi.unstubAllGlobals();
  });
});
