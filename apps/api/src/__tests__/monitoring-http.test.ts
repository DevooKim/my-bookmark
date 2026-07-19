import { API_ERROR_CODES } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createErrorMiddleware, HttpError } from "../middleware/error";
import { createSecurityMonitor } from "../middleware/security-monitor";
import type { AlertDispatcher } from "../services/alerting";
import type { OperationalMonitor } from "../services/operational-monitor";

function operationalMonitor(): OperationalMonitor {
  return {
    recordAiUsage: vi.fn(),
    recordCronFailure: vi.fn(),
    recordCronSuccess: vi.fn(),
    recordUnexpectedHttpError: vi.fn(),
  };
}

describe("monitoring HTTP boundary", () => {
  it("returns 400 and alerts on the fifth malformed JSON request", async () => {
    const alerts: AlertDispatcher = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const app = createApp({ alerts, operationalMonitor: operationalMonitor() });
    let response: request.Response | undefined;

    for (let index = 0; index < 5; index += 1) {
      response = await request(app)
        .post("/api/bookmarks")
        .set("Content-Type", "application/json")
        .send("{");
    }

    expect(response?.status).toBe(400);
    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.stringContaining("malformed"),
      }),
    );
  });

  it("reports unexpected 500 but not an ordinary 401", async () => {
    const alerts: AlertDispatcher = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const security = createSecurityMonitor({ alerts });
    const monitor = operationalMonitor();
    const app = express();
    app.use(security.middleware);
    app.get("/fail", () => {
      throw new Error("private failure");
    });
    app.get("/unauthorized", () => {
      throw new HttpError(401, API_ERROR_CODES.UNAUTHORIZED, "Unauthorized");
    });
    app.use(
      createErrorMiddleware({
        operationalMonitor: monitor,
        securityMonitor: security,
      }),
    );

    expect((await request(app).get("/fail")).status).toBe(500);
    expect((await request(app).get("/unauthorized")).status).toBe(401);
    expect(monitor.recordUnexpectedHttpError).toHaveBeenCalledOnce();
  });
});
