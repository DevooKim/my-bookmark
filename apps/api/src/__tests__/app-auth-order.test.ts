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

  it("keeps API-key-disallowed routes at 401 even after many X-API-Key requests", async () => {
    const app = createApp();
    let response: request.Response | undefined;

    for (let i = 0; i < 61; i += 1) {
      response = await request(app)
        .get("/api/keys")
        .set("X-API-Key", "bm_test");
    }

    expect(response?.status).toBe(401);
    expect(response?.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the common JSON error shape when API-key rate limit is exceeded", async () => {
    const app = createApp();
    let response: request.Response | undefined;

    for (let i = 0; i < 61; i += 1) {
      response = await request(app)
        .get("/api/bookmarks")
        .set("X-API-Key", "bm_test");
    }

    expect(response?.status).toBe(429);
    expect(response?.type).toBe("application/json");
    expect(response?.body).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
  });

  it("rate limits API-key requests to the unified share endpoint", async () => {
    const app = createApp();
    let response: request.Response | undefined;

    for (let i = 0; i < 61; i += 1) {
      response = await request(app)
        .post("/api/share")
        .set("X-API-Key", "bm_test")
        .field("item", "https://example.com/post");
    }

    expect(response?.status).toBe(429);
    expect(response?.body.error.code).toBe("RATE_LIMITED");
  });
});
