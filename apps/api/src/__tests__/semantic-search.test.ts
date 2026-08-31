import type { EmbeddingProvider } from "@my-bookmark/ai";
import { API_ERROR_CODES, type Bookmark } from "@my-bookmark/shared";
import { describe, expect, it, vi } from "vitest";
import { BOOKMARK_DB_COLUMNS } from "../lib/db-mappers";
import { searchSemanticBookmarksForUser } from "../routes/bookmarks";

const userId = "11111111-1111-4111-8111-111111111111";

function createProvider(): {
  provider: EmbeddingProvider;
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
  return { provider: { embed }, embed };
}

function createMappedBookmark(): Bookmark {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId,
    kind: "link",
    url: "https://example.com/article",
    image: null,
    title: "식당 추천",
    description: "맛있는 식당 기록",
    siteName: "example.com",
    faviconUrl: null,
    ogImageUrl: null,
    categoryId: null,
    tags: [],
    metadata: {},
    aiStatus: "idle",
    aiModel: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("semantic bookmark search", () => {
  it("embeds the query, calls the RPC, and returns the list shape", async () => {
    const { provider, embed } = createProvider();
    const select = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "row" }], error: null });
    const rpc = vi.fn().mockReturnValue({ select });
    const mapBookmark = vi.fn().mockResolvedValue(createMappedBookmark());

    const result = await searchSemanticBookmarksForUser(
      userId,
      { q: "맛집", limit: 10 },
      {
        db: { rpc },
        embeddingProvider: provider,
        mapBookmark,
      },
    );

    expect(embed).toHaveBeenCalledWith({ text: "맛집" });
    expect(rpc).toHaveBeenCalledWith("semantic_search_bookmarks", {
      p_user_id: userId,
      p_embedding: "[0.1,0.2]",
      p_limit: 10,
    });
    expect(select).toHaveBeenCalledWith(BOOKMARK_DB_COLUMNS);
    expect(mapBookmark).toHaveBeenCalledWith({ id: "row" }, false);
    expect(result).toEqual({
      bookmarks: [createMappedBookmark()],
      nextCursor: null,
    });
    expect(rpc.mock.calls[0]?.[1].p_embedding).toBe("[0.1,0.2]");
  });

  it("returns a clear server error when semantic search is not configured", async () => {
    const rpc = vi.fn();

    await expect(
      searchSemanticBookmarksForUser(
        userId,
        { q: "맛집", limit: 20 },
        { db: { rpc }, embeddingProvider: null },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: API_ERROR_CODES.INTERNAL,
      message: "Semantic search is not configured",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
