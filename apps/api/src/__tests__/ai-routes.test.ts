import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createAiRouter } from "../routes/ai";
import type { AiSettingsService } from "../services/ai-provider";

const userId = "11111111-1111-4111-8111-111111111111";
const status = {
  provider: "gemini" as const,
  model: "gemini-flash-lite-latest" as const,
  enabled: false,
  providers: {
    gemini: { configured: false },
    anthropic: { configured: true },
    openai: { configured: false },
  },
};

function setup() {
  const service: AiSettingsService = {
    getStatus: vi.fn().mockResolvedValue(status),
    save: vi.fn().mockResolvedValue({ ...status, enabled: true }),
    deleteKey: vi.fn().mockResolvedValue(status),
    getProvider: vi.fn(),
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

  it("saves a selected provider and optional replacement key", async () => {
    const { app, service } = setup();
    const response = await request(app)
      .put("/api/ai")
      .set("Authorization", "Bearer token")
      .send({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "new-secret",
      });

    expect(response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith(userId, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "new-secret",
    });
    expect(JSON.stringify(response.body)).not.toContain("new-secret");
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
      .put("/api/ai")
      .set("Authorization", "Bearer token")
      .send({
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        apiKey: " ",
      });

    expect(invalidProvider.status).toBe(400);
    expect(blankKey.status).toBe(400);
  });

  it("requires Bearer authentication", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/ai")).status).toBe(401);
  });
});
