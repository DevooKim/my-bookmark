import { readFileSync } from "node:fs";
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

  it("pins package management and Docker builds to Bun 1.4.0", () => {
    const repositoryRoot = path.resolve(__dirname, "../../../..");
    const rootPackageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { packageManager?: string };
    const dockerfiles = ["apps/web/Dockerfile"];

    expect(rootPackageJson.packageManager).toBe("bun@1.4.0");
    for (const dockerfile of dockerfiles) {
      expect(
        readFileSync(path.join(repositoryRoot, dockerfile), "utf8"),
        dockerfile,
      ).toContain("FROM docker.io/oven/bun:1.4.0-alpine AS base");
    }
  });

  it("serves only built public files in the static runtime", () => {
    const dockerfile = readFileSync(
      path.resolve(__dirname, "../../Dockerfile"),
      "utf8",
    );

    expect(dockerfile).toContain(
      "FROM docker.io/library/caddy:2-alpine AS runtime",
    );
    expect(dockerfile).toContain("/app/apps/web/.output/public /srv");
  });

  it("pins TypeScript 7 across TypeScript workspaces", () => {
    const repositoryRoot = path.resolve(__dirname, "../../../..");
    const manifestPaths = [
      "package.json",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/ai/package.json",
    ];

    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(
        readFileSync(path.join(repositoryRoot, manifestPath), "utf8"),
      ) as { devDependencies?: { typescript?: string } };

      expect(manifest.devDependencies?.typescript, manifestPath).toBe("7.0.2");
    }

    const webManifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "apps/web/package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };

    expect(webManifest.devDependencies["@types/node"]).toMatch(/^\^24\./);
  });

  it("configures static cache headers and the API proxy", () => {
    const caddyfile = readFileSync(
      path.resolve(__dirname, "../../Caddyfile"),
      "utf8",
    );

    expect(caddyfile).toContain("reverse_proxy api:3001");
    expect(caddyfile).toContain("/assets/app-styles.css");
    expect(caddyfile).toContain('Cache-Control "no-cache"');
    expect(caddyfile).toContain("/icons/* /manifest.webmanifest");
    expect(caddyfile).toContain("try_files {path} /index.html");
  });
});
