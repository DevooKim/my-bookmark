import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./support/loopback-request";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-07-12T12:00:00.000Z";

const mocks = vi.hoisted(() => ({
  embeddingProvider: null as { embed: ReturnType<typeof vi.fn> } | null,
  rpc: vi.fn(),
  update: vi.fn(),
  updateBookmarkEmbedding: vi.fn(),
  placeRows: [] as Record<string, unknown>[],
  placeIn: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: vi.fn((table: string) =>
      table === "bookmark_places"
        ? {
            select: () => ({
              eq: () => ({
                in: (field: string, ids: string[]) => {
                  mocks.placeIn(field, ids);
                  return {
                    order: () =>
                      Promise.resolve({ data: mocks.placeRows, error: null }),
                  };
                },
              }),
            }),
          }
        : { update: mocks.update },
    ),
  },
}));

vi.mock("../services/embedding-provider", () => ({
  getEmbeddingProvider: () => mocks.embeddingProvider,
}));

vi.mock("../services/embedding", () => ({
  updateBookmarkEmbedding: mocks.updateBookmarkEmbedding,
}));

vi.mock("../middleware/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/auth")>();
  return {
    ...original,
    requireAuth:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.userId = userId;
        next();
      },
  };
});

import { BOOKMARK_DB_COLUMNS } from "../lib/db-mappers";
import { errorMiddleware } from "../middleware/error";
import { bookmarksRouter } from "../routes/bookmarks";

function bookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: bookmarkId,
    user_id: userId,
    kind: "link",
    url: "https://example.com/article",
    title: "Article",
    description: null,
    site_name: null,
    favicon_url: null,
    og_image_url: null,
    category_id: null,
    tags: ["React", "개발"],
    metadata: { 지역: "서울" },
    ai_status: "idle",
    ai_model: null,
    image_original_path: null,
    image_thumbnail_path: null,
    image_mime_type: null,
    image_file_size: null,
    image_width: null,
    image_height: null,
    image_filename: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function mockRpcRows(rows: Record<string, unknown>[]) {
  const select = vi.fn().mockResolvedValue({ data: rows, error: null });
  mocks.rpc.mockReturnValue({ select });
  return select;
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", bookmarksRouter);
  app.use(errorMiddleware);
  return app;
}

function mockBookmarkPatch(row = bookmarkRow()) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const select = vi.fn(() => ({ maybeSingle }));
  const secondEq = vi.fn(() => ({ select }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  mocks.update.mockReturnValue({ eq: firstEq });
}

beforeEach(() => {
  mocks.embeddingProvider = null;
  mocks.rpc.mockReset();
  mocks.update.mockReset();
  mocks.updateBookmarkEmbedding.mockReset();
  mocks.updateBookmarkEmbedding.mockResolvedValue(undefined);
  mocks.placeRows = [];
  mocks.placeIn.mockReset();
});

describe("bookmark tags API", () => {
  it("replaces normalized bookmark metadata and cancels pending AI", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: bookmarkRow({
        metadata: {
          네이버지도: "https://map.naver.com/p/search/test",
          메모: "예약",
        },
        ai_status: "idle",
      }),
      error: null,
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    mocks.update.mockReturnValue({ eq: firstEq });

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({
        metadata: {
          " 네이버지도 ": " https://map.naver.com/p/search/test ",
          메모: " 예약 ",
        },
      });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      metadata: {
        네이버지도: "https://map.naver.com/p/search/test",
        메모: "예약",
      },
      ai_status: "idle",
    });
    expect(response.body.bookmark.metadata).toEqual({
      네이버지도: "https://map.naver.com/p/search/test",
      메모: "예약",
    });
  });

  it("clears bookmark metadata with an empty object", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: bookmarkRow({ metadata: {}, ai_status: "idle" }),
      error: null,
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    mocks.update.mockReturnValue({ eq: firstEq });

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({ metadata: {} });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      metadata: {},
      ai_status: "idle",
    });
  });
  it("updates normalized bookmark tags", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: bookmarkRow({ ai_status: "idle" }),
      error: null,
    });
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    mocks.update.mockReturnValue({ eq: firstEq });

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({ tags: [" React ", "개발", "React"] });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      tags: ["React", "개발"],
      ai_status: "idle",
    });
    expect(response.body.bookmark.tags).toEqual(["React", "개발"]);
  });

  it("refreshes the embedding when title, description, or tags change", async () => {
    const embeddingProvider = { embed: vi.fn() };
    mocks.embeddingProvider = embeddingProvider;
    mockBookmarkPatch(
      bookmarkRow({
        title: "새 제목",
        description: "새 설명",
        tags: ["새 태그"],
      }),
    );

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({
        title: "새 제목",
        description: "새 설명",
        tags: ["새 태그"],
      });

    expect(response.status).toBe(200);
    expect(mocks.updateBookmarkEmbedding).toHaveBeenCalledWith({
      db: expect.any(Object),
      userId,
      bookmarkId,
      provider: embeddingProvider,
      content: {
        title: "새 제목",
        description: "새 설명",
        tags: ["새 태그"],
      },
    });
  });

  it("does not refresh the embedding when only the category changes", async () => {
    mockBookmarkPatch(bookmarkRow({ category_id: null }));

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({ categoryId: null });

    expect(response.status).toBe(200);
    expect(mocks.updateBookmarkEmbedding).not.toHaveBeenCalled();
  });

  it("keeps PATCH successful when embedding refresh fails", async () => {
    mocks.embeddingProvider = { embed: vi.fn() };
    mocks.updateBookmarkEmbedding.mockRejectedValueOnce(
      new Error("embedding failed"),
    );
    mockBookmarkPatch(bookmarkRow({ title: "새 제목" }));

    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({ title: "새 제목" });

    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(mocks.updateBookmarkEmbedding).toHaveBeenCalled(),
    );
  });

  it("rejects more than five tags", async () => {
    const response = await request(createTestApp())
      .patch(`/api/bookmarks/${bookmarkId}`)
      .send({ tags: ["1", "2", "3", "4", "5", "6"] });

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lists bookmarks through the user-scoped search RPC and preserves the cursor", async () => {
    const olderId = "44444444-4444-4444-8444-444444444444";
    const cursor = Buffer.from(
      JSON.stringify({ createdAt, id: bookmarkId }),
      "utf8",
    ).toString("base64url");
    const select = mockRpcRows([
      bookmarkRow({ embedding: [0.1, 0.2] }),
      bookmarkRow({ id: olderId }),
    ]);

    const response = await request(createTestApp())
      .get("/api/bookmarks")
      .query({
        q: "React",
        categoryId,
        cursor,
        limit: 1,
      });

    expect(response.status).toBe(200);
    expect(select).toHaveBeenCalledWith(BOOKMARK_DB_COLUMNS);
    expect(response.body.items[0]).not.toHaveProperty("embedding");
    expect(mocks.rpc).toHaveBeenCalledWith("search_bookmarks", {
      p_user_id: userId,
      p_query: "React",
      p_category_id: categoryId,
      p_uncategorized: false,
      p_kind: null,
      p_cursor_created_at: createdAt,
      p_cursor_id: bookmarkId,
      p_limit: 2,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].metadata).toEqual({ 지역: "서울" });
    expect(response.body.nextCursor).toBe(
      Buffer.from(
        JSON.stringify({ createdAt, id: bookmarkId }),
        "utf8",
      ).toString("base64url"),
    );
  });

  it("passes the uncategorized filter to the search RPC", async () => {
    mockRpcRows([]);

    const response = await request(createTestApp())
      .get("/api/bookmarks")
      .query({ categoryId: "none" });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "search_bookmarks",
      expect.objectContaining({
        p_user_id: userId,
        p_category_id: null,
        p_uncategorized: true,
      }),
    );
  });
});
