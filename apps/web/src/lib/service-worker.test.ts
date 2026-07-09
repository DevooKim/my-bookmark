import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./service-worker";

describe("registerServiceWorker", () => {
  it("registers /sw.js when service workers are available", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    await registerServiceWorker({
      navigator: { serviceWorker: { register } },
      location: { protocol: "https:" },
    });

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("skips registration when service workers are unavailable", async () => {
    await expect(
      registerServiceWorker({
        navigator: {},
        location: { protocol: "https:" },
      }),
    ).resolves.toBeUndefined();
  });
});
