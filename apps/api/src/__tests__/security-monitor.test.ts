import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createSecurityMonitor } from "../middleware/security-monitor";
import type { AlertDispatcher } from "../services/alerting";

function setup() {
  let now = new Date("2026-07-19T12:00:00.000Z");
  const alerts: AlertDispatcher = {
    notify: vi.fn().mockResolvedValue(undefined),
  };
  const monitor = createSecurityMonitor({ alerts, now: () => now });
  const app = express();
  app.set("trust proxy", 1);
  app.use(monitor.middleware);
  app.all("/status/:code", (req, res) =>
    res.sendStatus(Number(req.params.code)),
  );
  app.use("/api", (_req, res) => {
    Object.assign(res.locals, { securityRouteNotFound: true });
    res.sendStatus(404);
  });
  return { app, alerts, setNow: (value: Date) => (now = value) };
}

async function hit(app: express.Express, path: string, ip: string) {
  await request(app).get(path).set("X-Forwarded-For", ip);
}

describe("security monitor", () => {
  it("alerts on the fifth authentication failure from one IP in one minute", async () => {
    const { app, alerts } = setup();
    for (let index = 0; index < 5; index += 1) {
      await hit(app, "/status/401", "100.87.42.16");
    }

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "security:authentication:100.87.42.16",
        sourceIp: "100.87.42.16",
        count: 5,
        windowLabel: "1분",
      }),
    );
  });

  it("does not combine authentication failures from different IPs", async () => {
    const { app, alerts } = setup();
    for (let index = 0; index < 4; index += 1) {
      await hit(app, "/status/401", "100.87.42.16");
      await hit(app, "/status/401", "100.87.42.17");
    }
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  it("alerts immediately on a sensitive API path", async () => {
    const { app, alerts } = setup();
    await hit(app, "/api/.env", "100.87.42.18");

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "security:sensitive-path:100.87.42.18",
        path: "/api/.env",
      }),
    );
  });

  it("counts only terminal route misses toward the 404 threshold", async () => {
    const { app, alerts } = setup();
    for (let index = 0; index < 19; index += 1) {
      await hit(app, "/api/missing", "100.87.42.19");
    }
    expect(alerts.notify).not.toHaveBeenCalled();
    await hit(app, "/api/missing", "100.87.42.19");
    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
  });

  it.each([
    { status: 413, attempts: 5, fingerprint: "malformed" },
    { status: 429, attempts: 20, fingerprint: "rate-limit" },
  ])("alerts when status $status reaches its threshold", async ({
    status,
    attempts,
    fingerprint,
  }) => {
    const { app, alerts } = setup();
    for (let index = 0; index < attempts; index += 1) {
      await hit(app, `/status/${status}`, "100.87.42.20");
    }

    await vi.waitFor(() => expect(alerts.notify).toHaveBeenCalledOnce());
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.stringContaining(fingerprint),
        count: attempts,
      }),
    );
  });
});
