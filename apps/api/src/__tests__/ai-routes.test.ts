import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";

const usageMocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

const envMocks = vi.hoisted(() => ({
  appEnv: { OPEN_ROUTER_API_KEY: undefined as string | undefined },
}));

const providerMocks = vi.hoisted(() => ({
  getAiStatus: vi.fn(),
  testAiConnection: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ select: usageMocks.select })),
  },
}));

vi.mock("../lib/env", () => ({ appEnv: envMocks.appEnv }));

vi.mock("../services/ai-provider", () => ({
  getAiStatus: providerMocks.getAiStatus,
  testAiConnection: providerMocks.testAiConnection,
}));

const userId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.clearAllMocks();
  envMocks.appEnv.OPEN_ROUTER_API_KEY = undefined;
});

async function setup() {
  const { createAiRouter } = await import("../routes/ai");
  const app = express();
  app.use(express.json());
  app.use("/api", createAiRouter(requireAuth({ bearer: async () => userId })));
  app.use(errorMiddleware);
  return app;
}

describe("AI routes", () => {
  it("returns the preset status", async () => {
    providerMocks.getAiStatus.mockReturnValue({
      enabled: true,
      preset: "@preset/my-bookmark",
    });
    const app = await setup();

    const response = await request(app)
      .get("/api/ai")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      enabled: true,
      preset: "@preset/my-bookmark",
    });
  });

  it("tests the connection", async () => {
    providerMocks.testAiConnection.mockResolvedValue(true);
    const app = await setup();

    const response = await request(app)
      .post("/api/ai/test")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns usage events for the requested window", async () => {
    const rows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        user_id: userId,
        provider: "google",
        model: "google/gemini-3.1-flash-lite-20260507",
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
    usageMocks.select.mockReturnValue({ eq });

    const app = await setup();
    const response = await request(app)
      .get("/api/ai/usage?days=7")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(7);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      model: "google/gemini-3.1-flash-lite-20260507",
      status: "success",
      durationMs: 700,
    });
    expect(limit).toHaveBeenCalledWith(1000);
  });

  it("returns account usage from the OpenRouter key endpoint", async () => {
    envMocks.appEnv.OPEN_ROUTER_API_KEY = "or-key";
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchMock);

    const app = await setup();
    const response = await request(app)
      .get("/api/ai/account")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      usage: 1.2,
      usageDaily: 0.1,
      usageWeekly: 0.5,
      usageMonthly: 1.2,
      limit: 10,
      limitRemaining: 8.8,
      isFreeTier: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: { Authorization: "Bearer or-key" },
      }),
    );
    vi.unstubAllGlobals();
  });

  it("returns 400 for account usage without a configured key", async () => {
    envMocks.appEnv.OPEN_ROUTER_API_KEY = undefined;
    const app = await setup();

    const response = await request(app)
      .get("/api/ai/account")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(400);
  });

  it("removes the retired provider-scoped routes", async () => {
    const app = await setup();

    expect(
      (
        await request(app)
          .put("/api/ai/keys/gemini")
          .set("Authorization", "Bearer token")
          .send({ apiKey: "x" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put("/api/ai/model-order")
          .set("Authorization", "Bearer token")
          .send({ models: [] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/ai/test/openai")
          .set("Authorization", "Bearer token")
      ).status,
    ).toBe(404);
  });

  it("requires Bearer authentication", async () => {
    const app = await setup();
    expect((await request(app).get("/api/ai")).status).toBe(401);
  });
});
