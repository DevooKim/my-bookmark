import express from "express";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  type BearerVerifier,
  createApiKeyVerifier,
  createBearerAuth,
  createSupabaseJwksUrl,
  getUserId,
  requireAuth,
} from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";

async function createAuthFixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const issuer = "https://example.supabase.co/auth/v1";
  const audience = "authenticated";
  const userId = "11111111-1111-4111-8111-111111111111";
  const jwks = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }],
  });
  const bearerAuth = createBearerAuth({ issuer, audience, jwks });

  async function signToken(expiresAt = "2h", kid = "test-key") {
    return new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  }

  return { bearerAuth, signToken, userId };
}

function createTestApp(verify: BearerVerifier) {
  const app = express();
  app.get("/api/me", requireAuth({ bearer: verify }), (req, res) => {
    res.json({ userId: getUserId(req) });
  });
  app.use(errorMiddleware);
  return app;
}

function createApiKeyDb(row: unknown) {
  const updates: unknown[] = [];
  let isUpdating = false;
  const builder = {
    from: () => builder,
    select: () => builder,
    update: (value: unknown) => {
      isUpdating = true;
      updates.push(value);
      return builder;
    },
    eq: () => builder,
    is: () => (isUpdating ? Promise.resolve({ error: null }) : builder),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { db: builder, updates };
}

describe("createSupabaseJwksUrl", () => {
  it("uses Supabase well-known JWKS endpoint", () => {
    expect(
      createSupabaseJwksUrl("https://example.supabase.co").toString(),
    ).toBe("https://example.supabase.co/auth/v1/.well-known/jwks.json");
  });
});

describe("createBearerAuth", () => {
  it("returns user id for a valid Supabase JWT", async () => {
    const { bearerAuth, signToken, userId } = await createAuthFixture();

    await expect(bearerAuth(await signToken())).resolves.toBe(userId);
  });

  it("rejects an expired JWT", async () => {
    const { bearerAuth, signToken } = await createAuthFixture();

    await expect(bearerAuth(await signToken("-1s"))).rejects.toThrow(
      "Invalid bearer token",
    );
  });

  it("rejects a tampered JWT", async () => {
    const { bearerAuth, signToken } = await createAuthFixture();
    const token = await signToken();
    const tokenParts = token.split(".");
    const signature = tokenParts[2] ?? "";
    tokenParts[2] = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    const tamperedToken = tokenParts.join(".");

    await expect(bearerAuth(tamperedToken)).rejects.toThrow(
      "Invalid bearer token",
    );
  });
});

describe("requireAuth (HTTP boundary)", () => {
  it("returns 200 with the user id for a valid bearer token", async () => {
    const { bearerAuth, signToken, userId } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${await signToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it("accepts a case-insensitive bearer scheme", async () => {
    const { bearerAuth, signToken, userId } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", `bearer ${await signToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const { bearerAuth } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app).get("/api/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the Authorization header is not a bearer token", async () => {
    const { bearerAuth } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", "Basic abc123");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for an expired token", async () => {
    const { bearerAuth, signToken } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${await signToken("-1s")}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for a tampered token", async () => {
    const { bearerAuth, signToken } = await createAuthFixture();
    const app = createTestApp(bearerAuth);
    const token = await signToken();

    const response = await request(app)
      .get("/api/me")
      .set(
        "Authorization",
        `Bearer ${token.slice(0, -2)}${token.endsWith("a") ? "bb" : "aa"}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 502 (not 401) when the signing key cannot be resolved", async () => {
    // 유효 서명이지만 JWKS에 없는 kid → jose가 ERR_JWKS_NO_MATCHING_KEY.
    // JWKS 장애를 401로 뭉개지 않고 서버 에러로 드러내야 한다.
    const { bearerAuth, signToken } = await createAuthFixture();
    const app = createTestApp(bearerAuth);

    const response = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${await signToken("2h", "unknown-key")}`);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("INTERNAL");
  });

  it("returns 500 when userId is missing after auth (bypass guard)", async () => {
    // 미들웨어가 우회되어 userId 없이 핸들러에 도달하는 경우를 방어한다.
    const app = express();
    app.get("/api/me", (req, res) => {
      res.json({ userId: getUserId(req) });
    });
    app.use(errorMiddleware);

    const response = await request(app).get("/api/me");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL");
  });

  it("allows API key auth only when the route opts in", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const app = express();
    const verifyApiKey = async (key: string) => {
      if (key !== "bm_valid") {
        throw new Error("unexpected key");
      }
      return userId;
    };
    app.get(
      "/api/bookmarks",
      requireAuth({ apiKey: true, apiKeyVerifier: verifyApiKey }),
      (req, res) => res.json({ userId: getUserId(req) }),
    );
    app.get(
      "/api/keys",
      requireAuth({ apiKeyVerifier: verifyApiKey }),
      (req, res) => res.json({ userId: getUserId(req) }),
    );
    app.use(errorMiddleware);

    const allowed = await request(app)
      .get("/api/bookmarks")
      .set("X-API-Key", "bm_valid");
    const denied = await request(app)
      .get("/api/keys")
      .set("X-API-Key", "bm_valid");

    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ userId });
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("createApiKeyVerifier", () => {
  it("returns the owner user id for a valid non-revoked key and updates last_used_at", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const key = "bm_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    const { db, updates } = createApiKeyDb({
      user_id: userId,
      last_used_at: null,
    });

    const verifyApiKey = createApiKeyVerifier(db);

    await expect(verifyApiKey(key)).resolves.toBe(userId);
    expect(updates).toHaveLength(1);
  });

  it("rejects an invalid key", async () => {
    const { db } = createApiKeyDb(null);
    const verifyApiKey = createApiKeyVerifier(db);

    await expect(verifyApiKey("bm_missing")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});
