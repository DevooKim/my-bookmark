import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  navigateToLogin: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(async () => ({
    auth: {
      getSession: mocks.getSession,
      refreshSession: mocks.refreshSession,
    },
  })),
}));
vi.mock("./auth-redirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-redirect")>()),
  navigateToLogin: mocks.navigateToLogin,
}));

import {
  ApiClientError,
  createImage,
  getMe,
  listBookmarks,
} from "./api-client";

const imageBookmark = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  kind: "image",
  url: null,
  image: {
    thumbnailUrl: "https://signed.example/thumbnail",
    originalUrl: null,
    mimeType: "image/png",
    fileSize: 4,
    width: 2,
    height: 2,
    filename: "sample.png",
  },
  title: null,
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: [],
  aiStatus: "pending",
  aiModel: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "token" } },
    error: null,
  });
  mocks.refreshSession.mockResolvedValue({
    data: { session: { access_token: "refreshed-token" } },
    error: null,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("web session expiry", () => {
  it("redirects without making a request when the session has no token", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMe()).rejects.toMatchObject({ status: 401 });

    expect(mocks.navigateToLogin).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects when refreshing an initial 401 fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    mocks.refreshSession.mockRejectedValue(new Error("refresh failed"));

    await expect(getMe()).rejects.toMatchObject({ status: 401 });

    expect(mocks.navigateToLogin).toHaveBeenCalledOnce();
  });

  it("redirects when refresh succeeds without a new session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: "unexpected" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(getMe()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.navigateToLogin).toHaveBeenCalledOnce();
  });

  it("redirects when a refreshed request is still unauthorized", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMe()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.navigateToLogin).toHaveBeenCalledOnce();
  });

  it("does not treat an upstream auth outage as an expired session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "JWKS unavailable" } }),
            { status: 502 },
          ),
        ),
    );

    await expect(getMe()).rejects.toEqual(
      new ApiClientError("JWKS unavailable", 502, {
        error: { message: "JWKS unavailable" },
      }),
    );
    expect(mocks.navigateToLogin).not.toHaveBeenCalled();
  });
});

describe("image API client", () => {
  it("adds the image kind to bookmark list queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listBookmarks({ kind: "image" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("kind=image");
  });

  it("uploads FormData without overriding its content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ bookmark: imageBookmark }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3, 4])], "sample.png", {
      type: "image/png",
    });

    await expect(createImage(file)).resolves.toMatchObject({ kind: "image" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });
});
