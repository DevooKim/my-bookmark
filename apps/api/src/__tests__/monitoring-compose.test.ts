import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("monitoring compose configuration", () => {
  it("pins Kuma, persists data, and keeps service ports on loopback", () => {
    const compose = readFileSync(
      fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url)),
      "utf8",
    );

    expect(compose).toContain("louislam/uptime-kuma:2.4.0");
    expect(compose).toContain("uptime-kuma-data:/app/data");
    expect(compose).toContain("127.0.0.1:3001:3001");
    expect(compose).toContain("127.0.0.1:3000:3000");
    expect(compose).not.toContain("/var/run/docker.sock");
  });
});
