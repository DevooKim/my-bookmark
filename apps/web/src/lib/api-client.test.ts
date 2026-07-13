import { afterEach, describe, expect, it, vi } from "vitest";
import { createImage, listBookmarks } from "./api-client";

vi.mock("./supabase", () => ({
  getSupabase: vi.fn(async () => ({
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "token" } },
        error: null,
      })),
      refreshSession: vi.fn(),
    },
  })),
}));

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

afterEach(() => vi.unstubAllGlobals());

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
