import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-07-12T12:00:00.000Z";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: vi.fn(() => ({ update: mocks.update })),
  },
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

import { errorMiddleware } from "../middleware/error";
import { bookmarksRouter } from "../routes/bookmarks";

function bookmarkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: bookmarkId,
    user_id: userId,
    url: "https://example.com/article",
    title: "Article",
    description: null,
    site_name: null,
    favicon_url: null,
    og_image_url: null,
    category_id: null,
    tags: ["React", "개발"],
    ai_status: "idle",
    ai_model: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", bookmarksRouter);
  app.use(errorMiddleware);
  return app;
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.update.mockReset();
});

describe("bookmark tags API", () => {
  it("updates normalized bookmark tags", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: bookmarkRow(),
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
    expect(mocks.update).toHaveBeenCalledWith({ tags: ["React", "개발"] });
    expect(response.body.bookmark.tags).toEqual(["React", "개발"]);
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
    mocks.rpc.mockResolvedValue({
      data: [bookmarkRow(), bookmarkRow({ id: olderId })],
      error: null,
    });

    const response = await request(createTestApp())
      .get("/api/bookmarks")
      .query({
        q: "React",
        categoryId,
        cursor,
        limit: 1,
      });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("search_bookmarks", {
      p_user_id: userId,
      p_query: "React",
      p_category_id: categoryId,
      p_uncategorized: false,
      p_cursor_created_at: createdAt,
      p_cursor_id: bookmarkId,
      p_limit: 2,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.nextCursor).toBe(
      Buffer.from(
        JSON.stringify({ createdAt, id: bookmarkId }),
        "utf8",
      ).toString("base64url"),
    );
  });

  it("passes the uncategorized filter to the search RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

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
