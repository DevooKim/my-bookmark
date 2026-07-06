import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("app auth routing order", () => {
  it("does not let bearer-only routers intercept API-key bookmark requests", async () => {
    const response = await request(createApp())
      .get("/api/bookmarks")
      .set("X-API-Key", "bm_test");

    expect(response.status).toBe(401);
    expect(response.body.error.message).not.toBe("Missing bearer token");
  });
});
