import { describe, expect, it } from "vitest";
import { getRootEnvPath } from "../admin/lib/load-env";

describe("getRootEnvPath", () => {
  it("points to the monorepo root .env file", () => {
    expect(getRootEnvPath()).toMatch(/my-bookmark\/\.env$/);
  });
});
