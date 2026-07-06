import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createBearerAuth } from "../middleware/auth";

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

  async function signToken(expiresAt = "2h") {
    return new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiresAt)
      .sign(privateKey);
  }

  return { bearerAuth, signToken, userId };
}

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
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    await expect(bearerAuth(tamperedToken)).rejects.toThrow(
      "Invalid bearer token",
    );
  });
});
