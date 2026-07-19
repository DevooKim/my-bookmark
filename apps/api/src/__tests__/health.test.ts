import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createReadinessService } from "../services/readiness";

describe("GET /api/health", () => {
  it("returns ok true", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});

describe("GET /api/health/ready", () => {
  it("returns readiness state with an appropriate status", async () => {
    const readiness = createReadinessService({
      databaseCheck: async () => undefined,
    });
    readiness.setPushConfigured(true);
    readiness.markCronStarted();
    readiness.markCronSuccess();

    const response = await request(createApp({ readiness })).get(
      "/api/health/ready",
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
