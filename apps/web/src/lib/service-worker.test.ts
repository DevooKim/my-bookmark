import { describe, expect, it, vi } from "vitest";
import {
  clearServiceWorkerApiCache,
  registerServiceWorker,
} from "./service-worker";

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

describe("clearServiceWorkerApiCache", () => {
  it("asks the active service worker to clear its API cache and deletes CacheStorage directly", async () => {
    const postMessage = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);

    await clearServiceWorkerApiCache({
      caches: { delete: deleteCache },
      navigator: { serviceWorker: { controller: { postMessage } } },
      location: { protocol: "https:" },
    });

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_API_CACHE" });
    expect(deleteCache).toHaveBeenCalledWith("my-bookmark-api-v1");
  });

  it("still clears CacheStorage when the page is not controlled by a service worker", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);

    await clearServiceWorkerApiCache({
      caches: { delete: deleteCache },
      navigator: { serviceWorker: {} },
      location: { protocol: "https:" },
    });

    expect(deleteCache).toHaveBeenCalledWith("my-bookmark-api-v1");
  });
});
