import { describe, expect, it } from "vitest";
import { getRootEnvPath } from "../lib/load-env";

describe("getRootEnvPath", () => {
  it("points to the monorepo root .env file", () => {
    expect(getRootEnvPath()).toMatch(/my-bookmark\/\.env$/);
  });
});
