import { describe, expect, it } from "vitest";
import { parseEnv } from "../lib/env";

describe("parseEnv", () => {
  it("uses phase 0 defaults for local development", () => {
    expect(parseEnv({}).PORT).toBe(3001);
    expect(parseEnv({}).WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("rejects invalid WEB_ORIGIN", () => {
    expect(() => parseEnv({ WEB_ORIGIN: "not-a-url" })).toThrow();
  });
});
