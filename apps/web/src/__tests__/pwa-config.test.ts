import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA configuration", () => {
  it("builds the service worker before the production web build", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    ) as { scripts: { build: string; "build:sw": string } };

    expect(packageJson.scripts["build:sw"]).toContain("esbuild src/sw/sw.ts");
    expect(packageJson.scripts.build).toMatch(/^pnpm build:sw &&/);
  });

  it("sets runtime cache headers for PWA assets", () => {
    const viteConfig = readFileSync(
      path.resolve(__dirname, "../../vite.config.ts"),
      "utf8",
    );

    expect(viteConfig).toContain('"/sw.js"');
    expect(viteConfig).toContain('"cache-control": "no-cache"');
    expect(viteConfig).toContain('"/icons/**"');
    expect(viteConfig).toContain('"/manifest.webmanifest"');
  });
});
