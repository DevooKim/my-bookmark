import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("vite config", () => {
  it("loads environment variables from the monorepo root", () => {
    const viteConfig = readFileSync(
      path.resolve(__dirname, "../../vite.config.ts"),
      "utf8",
    );

    expect(viteConfig).toContain(
      'envDir: fileURLToPath(new URL("../..", import.meta.url))',
    );
  });
});
