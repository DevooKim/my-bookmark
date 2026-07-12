import { describe, expect, it, vi } from "vitest";
import { createAiUsageRecorder, listAiUsageEvents } from "../services/ai-usage";

const userId = "11111111-1111-4111-8111-111111111111";

describe("ai usage recorder", () => {
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
    });
  });
});
