import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorMiddleware } from "../middleware/error";
import { bookmarksRouter } from "../routes/bookmarks";

const fake = vi.hoisted(() => ({
  embed: vi.fn(),
  rpc: vi.fn(),
  userId: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("../lib/supabase", () => ({
  supabaseAdmin: { rpc: fake.rpc },
}));
vi.mock("../middleware/auth", () => ({
  getUserId: () => fake.userId,
  requireAuth:
    () => (_request: Request, _response: Response, next: NextFunction) =>
      next(),
}));
vi.mock("../services/ai-provider", () => ({
  getAiProvider: () => null,
}));
vi.mock("../services/embedding-provider", () => ({
  getEmbeddingProvider: () => ({ embed: fake.embed }),
}));

const bookmarkRow = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: fake.userId,
  kind: "link" as const,
  url: "https://example.com/article",
  title: "식당 추천",
  description: "맛있는 식당 기록",
  site_name: "example.com",
  favicon_url: null,
  og_image_url: null,
  category_id: null,
  tags: [],
  metadata: {},
  ai_status: "idle" as const,
  ai_model: null,
  image_original_path: null,
  image_thumbnail_path: null,
  image_mime_type: null,
  image_file_size: null,
  image_width: null,
  image_height: null,
  image_filename: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", bookmarksRouter);
  app.use(errorMiddleware);
  return app;
}

describe("semantic bookmark search route", () => {
  it("serves the semantic path before the bookmark id route", async () => {
    fake.embed.mockResolvedValue([0.1, 0.2]);
    const select = vi
      .fn()
      .mockResolvedValue({ data: [bookmarkRow], error: null });
    fake.rpc.mockReturnValue({ select });

    const response = await request(createApp())
      .get("/api/bookmarks/search/semantic")
      .query({ q: "  맛집 ", limit: "7" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      items: [
        {
          id: bookmarkRow.id,
          title: bookmarkRow.title,
          url: bookmarkRow.url,
        },
      ],
      nextCursor: null,
    });
    expect(fake.embed).toHaveBeenCalledWith({ text: "맛집" });
    expect(fake.rpc).toHaveBeenCalledWith("semantic_search_bookmarks", {
      p_user_id: fake.userId,
      p_embedding: [0.1, 0.2],
      p_limit: 7,
      p_max_distance: 0.6,
    });
  });
});
