import { describe, expect, it } from "vitest";
import {
  aiAccountUsageResponseSchema,
  aiConnectionTestResponseSchema,
  aiStatusResponseSchema,
  aiUsageEventSchema,
} from "../index";

describe("AI schemas", () => {
  it("parses the preset status response", () => {
    expect(
      aiStatusResponseSchema.parse({
        enabled: true,
        preset: "@preset/my-bookmark",
      }),
    ).toEqual({ enabled: true, preset: "@preset/my-bookmark" });
  });

  it("parses connection test results", () => {
    expect(aiConnectionTestResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
  });

  it("parses the OpenRouter account usage response", () => {
    expect(
      aiAccountUsageResponseSchema.parse({
        usage: 1.2,
        usageDaily: 0.1,
        usageWeekly: 0.5,
        usageMonthly: 1.2,
        limit: 10,
        limitRemaining: 8.8,
        isFreeTier: false,
      }),
    ).toEqual({
      usage: 1.2,
      usageDaily: 0.1,
      usageWeekly: 0.5,
      usageMonthly: 1.2,
      limit: 10,
      limitRemaining: 8.8,
      isFreeTier: false,
    });
  });

  it("accepts a free-text provider on usage events", () => {
    expect(
      aiUsageEventSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        provider: "google",
        model: "google/gemini-3.1-flash-lite-20260507",
        bookmarkId: null,
        status: "success",
        errorCode: null,
        durationMs: 700,
        isByok: true,
        createdAt: "2026-07-12T10:00:00.000Z",
      }),
    ).toMatchObject({ provider: "google" });
  });
});
