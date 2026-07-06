import { describe, expect, it } from "vitest";
import { parseEnv } from "../lib/env";

describe("parseEnv", () => {
  it("uses safe defaults in test", () => {
    const env = parseEnv({ NODE_ENV: "test" });

    expect(env.PORT).toBe(3001);
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("requires Supabase settings outside test", () => {
    expect(() => parseEnv({})).toThrow("SUPABASE_URL is required outside test");
  });

  it("rejects invalid WEB_ORIGIN", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "test", WEB_ORIGIN: "not-a-url" }),
    ).toThrow();
  });
});
