import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpLogger } from "../app";

function createLogCapture() {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  };
}

describe("HTTP logging", () => {
  it("redacts bearer and API key header values from request logs", async () => {
    const { chunks, stream } = createLogCapture();
    const app = express();
    app.use(createHttpLogger({ level: "info", stream }));
    app.get("/api/bookmarks", (_req, res) => res.json({ ok: true }));

    await request(app)
      .get("/api/bookmarks")
      .set("Authorization", "Bearer secret-token")
      .set("X-API-Key", "bm_secret_api_key");

    const logOutput = chunks.join("\n");
    expect(logOutput).not.toContain("secret-token");
    expect(logOutput).not.toContain("bm_secret_api_key");
    expect(logOutput).toContain("[Redacted]");
  });
});
