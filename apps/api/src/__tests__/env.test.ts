import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../app";
import { parseEnv } from "../lib/env";

describe("parseEnv", () => {
  it("uses safe defaults in test", () => {
    const env = parseEnv({ NODE_ENV: "test" });

    expect(env.PORT).toBe(3001);
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("requires Supabase and AI encryption settings outside test", () => {
    expect(() => parseEnv({})).toThrow("SUPABASE_URL is required outside test");
    expect(() =>
      parseEnv({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "secret",
      }),
    ).toThrow("AI_SETTINGS_ENCRYPTION_KEY is required outside test");
  });

  it("rejects an AI encryption key that is not 32 base64 bytes", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        AI_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64"),
      }),
    ).toThrow("AI_SETTINGS_ENCRYPTION_KEY must encode exactly 32 bytes");
  });

  it("rejects invalid WEB_ORIGIN", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "test", WEB_ORIGIN: "not-a-url" }),
    ).toThrow();
  });

  it("keeps TRUST_PROXY optional", () => {
    expect(parseEnv({ NODE_ENV: "test" }).TRUST_PROXY).toBeUndefined();
    expect(parseEnv({ NODE_ENV: "test", TRUST_PROXY: "1" }).TRUST_PROXY).toBe(
      "1",
    );
  });
});

describe("parseTrustProxy", () => {
  it("maps hop counts, booleans, and subnet strings", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("0")).toBe(0);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("loopback")).toBe("loopback");
  });
});
