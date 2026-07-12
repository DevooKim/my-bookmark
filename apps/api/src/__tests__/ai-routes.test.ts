import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createAiRouter } from "../routes/ai";
import type { AiSettingsService } from "../services/ai-provider";

const usageMocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ select: usageMocks.select })),
  },
}));

const userId = "11111111-1111-4111-8111-111111111111";
const status = {
  provider: "gemini" as const,
  model: "gemini-flash-lite-latest" as const,
  enabled: false,
  modelOrder: [],
  providers: {
    gemini: { configured: false },
    anthropic: { configured: true },
    openai: { configured: false },
  },
};

function setup() {
  const service: AiSettingsService = {
    getStatus: vi.fn().mockResolvedValue(status),
    saveKey: vi.fn().mockResolvedValue({ ...status, enabled: true }),
    selectModel: vi.fn().mockResolvedValue({ ...status, enabled: true }),
    deleteKey: vi.fn().mockResolvedValue(status),
    getProvider: vi.fn(),
    getProviderChain: vi.fn().mockResolvedValue([]),
    reorderModels: vi.fn().mockResolvedValue({ ...status, enabled: true }),
    testConnection: vi.fn().mockResolvedValue(true),
    invalidate: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAiRouter(service, requireAuth({ bearer: async () => userId })),
  );
  app.use(errorMiddleware);
  return { app, service };
}

describe("AI settings routes", () => {
  it("returns status without credential values", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .get("/api/ai")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
    expect(JSON.stringify(response.body)).not.toContain("api_key");
    expect(service.getStatus).toHaveBeenCalledWith(userId);
  });

  it("saves a provider key without a model payload", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .put("/api/ai/keys/anthropic")
      .set("Authorization", "Bearer token")
      .send({ apiKey: "new-secret" });

    expect(response.status).toBe(200);
    expect(service.saveKey).toHaveBeenCalledWith(
      userId,
      "anthropic",
      "new-secret",
    );
    expect(JSON.stringify(response.body)).not.toContain("new-secret");
  });

  it("selects a model independently from provider keys", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .put("/api/ai/model")
      .set("Authorization", "Bearer token")
      .send({ provider: "anthropic", model: "claude-sonnet-4-6" });

    expect(response.status).toBe(200);
    expect(service.selectModel).toHaveBeenCalledWith(userId, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("removes the ambiguous combined settings endpoint", async () => {
    const { app } = setup();
    const response = await request(app)
      .put("/api/ai")
      .set("Authorization", "Bearer token")
      .send({ provider: "anthropic", model: "claude-sonnet-4-6" });

    expect(response.status).toBe(404);
  });

  it("tests a configured provider connection", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .post("/api/ai/test/openai")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ provider: "openai", ok: true });
    expect(service.testConnection).toHaveBeenCalledWith(userId, "openai");
  });

  it("returns a safe failed result when provider validation fails", async () => {
    const { app, service } = setup();
    vi.mocked(service.testConnection).mockResolvedValueOnce(false);

    const response = await request(app)
      .post("/api/ai/test/openai")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ provider: "openai", ok: false });
  });

  it("deletes a provider key", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .delete("/api/ai/keys/openai")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(service.deleteKey).toHaveBeenCalledWith(userId, "openai");
  });

  it("rejects invalid providers and blank keys", async () => {
    const { app } = setup();
    const invalidProvider = await request(app)
      .delete("/api/ai/keys/other")
      .set("Authorization", "Bearer token");
    const blankKey = await request(app)
      .put("/api/ai/keys/gemini")
      .set("Authorization", "Bearer token")
      .send({ apiKey: " " });

    expect(invalidProvider.status).toBe(400);
    expect(blankKey.status).toBe(400);
  });

  it("requires Bearer authentication", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/ai")).status).toBe(401);
  });

  it("returns usage events for the requested window", async () => {
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
    usageMocks.select.mockReturnValue({ eq });

    const { app } = setup();
    const response = await request(app)
      .get("/api/ai/usage?days=7")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(7);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      model: "gemini-flash-lite-latest",
      status: "success",
      durationMs: 700,
    });
    expect(limit).toHaveBeenCalledWith(1000);
  });
});
