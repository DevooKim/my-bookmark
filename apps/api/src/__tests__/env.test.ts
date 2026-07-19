import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../app";
import { parseEnv } from "../lib/env";

describe("parseEnv", () => {
  it("uses safe defaults in test", () => {
    const env = parseEnv({ NODE_ENV: "test" });

    expect(env.PORT).toBe(3001);
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("requires Supabase settings outside test", () => {
    expect(() => parseEnv({})).toThrow("SUPABASE_URL is required outside test");
    expect(() =>
      parseEnv({
        SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow("SUPABASE_SECRET_KEY is required outside test");
  });

  it("keeps OPEN_ROUTER_API_KEY optional in every environment", () => {
    expect(
      parseEnv({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "secret",
      }).OPEN_ROUTER_API_KEY,
    ).toBeUndefined();
    expect(
      parseEnv({ NODE_ENV: "test", OPEN_ROUTER_API_KEY: "or-key" })
        .OPEN_ROUTER_API_KEY,
    ).toBe("or-key");
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

  it("parses optional server-only Discord alert settings", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      DISCORD_ALERT_WEBHOOK_URL:
        "https://discord.com/api/webhooks/123/example-token",
      ALERT_ENV: "home-production",
    });

    expect(env.DISCORD_ALERT_WEBHOOK_URL).toBe(
      "https://discord.com/api/webhooks/123/example-token",
    );
    expect(env.ALERT_ENV).toBe("home-production");
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
