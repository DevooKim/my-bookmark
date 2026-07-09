import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyRequest,
  clearApiCache,
  handleFetch,
  handleMessage,
  shouldCacheResponse,
} from "./sw";

describe("service worker cache strategy", () => {
  it("uses cache-first only for hashed static assets", () => {
    expect(
      classifyRequest(new Request("https://app.test/assets/app.abc.js")),
    ).toBe("asset-cache-first");
  });

  it("uses network-first for the fixed-name stylesheet", () => {
    expect(
      classifyRequest(new Request("https://app.test/assets/app-styles.css")),
    ).toBe("asset-network-first");
    // hashed assets stay cache-first — only the fixed name revalidates
    expect(
      classifyRequest(new Request("https://app.test/assets/index-abc123.css")),
    ).toBe("asset-cache-first");
  });

  it("serves the deployed stylesheet over a stale cached copy", async () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: (request: Request) => stored.get(request.url),
      put: (request: Request, response: Response) => {
        stored.set(request.url, response);
        return Promise.resolve();
      },
    };
    vi.stubGlobal("caches", {
      match: (request: Request) => stored.get(request.url),
      open: () => Promise.resolve(cache),
    });
    const request = new Request("https://app.test/assets/app-styles.css");
    stored.set(request.url, new Response("body{old:1}", { status: 200 }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("body{new:1}", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const online = await handleFetch(request);
    await expect(online.text()).resolves.toBe("body{new:1}");

    const offline = await handleFetch(request);
    await expect(offline.text()).resolves.toBe("body{new:1}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses network-first for bookmark and category GET requests", () => {
    expect(
      classifyRequest(
        new Request("https://app.test/api/bookmarks?cursor=next"),
      ),
    ).toBe("api-network-first");
    expect(
      classifyRequest(
        new Request("https://app.test/api/categories?withCounts=true"),
      ),
    ).toBe("api-network-first");
  });

  it("never caches API mutations or unrelated API reads", () => {
    expect(
      classifyRequest(
        new Request("https://app.test/api/bookmarks", { method: "POST" }),
      ),
    ).toBe("network-only");
    expect(classifyRequest(new Request("https://app.test/api/keys"))).toBe(
      "network-only",
    );
  });

  it("stores only successful cacheable responses", () => {
    expect(shouldCacheResponse(new Response("ok", { status: 200 }))).toBe(true);
    expect(shouldCacheResponse(new Response("missing", { status: 404 }))).toBe(
      false,
    );
  });

  it("clears the API cache on request", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });

    await clearApiCache();

    expect(deleteCache).toHaveBeenCalledWith("my-bookmark-api-v1");
  });

  it("handles CLEAR_API_CACHE messages", () => {
    const waitUntil = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });

    handleMessage({ data: { type: "CLEAR_API_CACHE" }, waitUntil });

    expect(waitUntil).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("my-bookmark-api-v1");
  });

  it("falls back to the last successful bookmarks response when offline", async () => {
    const stored = new Map<string, Response>();
    const cache = {
      match: (request: Request) => stored.get(request.url),
      put: (request: Request, response: Response) => {
        stored.set(request.url, response);
        return Promise.resolve();
      },
    };
    vi.stubGlobal("caches", {
      match: (request: Request) => stored.get(request.url),
      open: () => Promise.resolve(cache),
    });
    const onlineResponse = new Response('{"items":[]}', {
      headers: { "content-type": "application/json" },
      status: 200,
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(onlineResponse)
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://app.test/api/bookmarks");
    await handleFetch(request);
    const offlineResponse = await handleFetch(request);

    await expect(offlineResponse.json()).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
