import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA configuration", () => {
  it("builds the service worker before the production web build", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    ) as { scripts: { build: string; "build:sw": string } };

    expect(packageJson.scripts["build:sw"]).toContain("esbuild src/sw/sw.ts");
    expect(packageJson.scripts.build).toMatch(/^bun run build:sw &&/);
  });

  it("uses the Vercel Bun runtime", () => {
    const configPath = path.resolve(__dirname, "../../vercel.json");

    expect(existsSync(configPath)).toBe(true);
    const vercelConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
      bunVersion?: string;
    };

    expect(vercelConfig.bunVersion).toBe("1.x");
  });

  it("excludes generated Vercel output from repository checks", () => {
    const biomeConfig = readFileSync(
      path.resolve(__dirname, "../../../../biome.json"),
      "utf8",
    );

    expect(biomeConfig).toContain('"!**/.vercel"');
  });

  it("uses Bun's hoisted linker for the Nitro npm alias", () => {
    const bunConfig = readFileSync(
      path.resolve(__dirname, "../../../../bunfig.toml"),
      "utf8",
    );

    expect(bunConfig).toContain('[install]\nlinker = "hoisted"');
  });

  it("pins local and CI Node execution to Node 24", () => {
    const rootPackageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const nodeVersion = readFileSync(
      path.resolve(__dirname, "../../../../.node-version"),
      "utf8",
    ).trim();

    expect(rootPackageJson.engines?.node).toBe("24.x");
    expect(nodeVersion).toBe("24");
  });

  it("builds the Docker fallback with the Node server preset", () => {
    const dockerfile = readFileSync(
      path.resolve(__dirname, "../../Dockerfile"),
      "utf8",
    );

    expect(dockerfile).toContain("ENV NITRO_PRESET=node-server");
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
