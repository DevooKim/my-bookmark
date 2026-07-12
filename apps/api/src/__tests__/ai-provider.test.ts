import { afterEach, describe, expect, it, vi } from "vitest";

const envMocks = vi.hoisted(() => ({
  appEnv: { OPEN_ROUTER_API_KEY: undefined as string | undefined },
}));

vi.mock("../lib/env", () => ({ appEnv: envMocks.appEnv }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  envMocks.appEnv.OPEN_ROUTER_API_KEY = undefined;
});

describe("AI provider service", () => {
  it("reports disabled status without a configured OpenRouter key", async () => {
    envMocks.appEnv.OPEN_ROUTER_API_KEY = undefined;
    const { getAiStatus, getAiProvider, testAiConnection } = await import(
      "../services/ai-provider"
    );

    expect(getAiStatus()).toEqual({
      enabled: false,
      preset: "@preset/my-bookmark",
    });
    expect(getAiProvider()).toBeNull();
    await expect(testAiConnection()).resolves.toBe(false);
  });

  it("reports enabled status and validates the connection with a configured key", async () => {
    envMocks.appEnv.OPEN_ROUTER_API_KEY = "or-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { getAiStatus, getAiProvider, testAiConnection } = await import(
      "../services/ai-provider"
    );

    expect(getAiStatus()).toEqual({
      enabled: true,
      preset: "@preset/my-bookmark",
    });
    expect(getAiProvider()).not.toBeNull();
    await expect(testAiConnection()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: { Authorization: "Bearer or-key" },
      }),
    );
  });

  it("returns false from testAiConnection when validation rejects", async () => {
    envMocks.appEnv.OPEN_ROUTER_API_KEY = "or-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { testAiConnection } = await import("../services/ai-provider");

    await expect(testAiConnection()).resolves.toBe(false);
    warn.mockRestore();
  });
});
