import { describe, expect, it, vi } from "vitest";
import {
  buildEmbeddingText,
  updateBookmarkEmbedding,
} from "../services/embedding";

const embedding = Array.from({ length: 1536 }, (_, index) =>
  index === 0 ? 1 : 0,
);

function createDb() {
  const secondEq = vi.fn().mockResolvedValue({ error: null });
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const update = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ update }));
  return { db: { from }, from, update, firstEq, secondEq };
}

describe("bookmark embeddings", () => {
  it("builds text from title, description, and tags only", () => {
    expect(
      buildEmbeddingText({
        title: "  제목 ",
        description: " 설명 ",
        tags: [" 태그1 ", "태그2"],
      }),
    ).toBe("제목\n설명\n태그1 태그2");
  });

  it("writes the generated vector with both ownership filters", async () => {
    const { db, from, update, firstEq, secondEq } = createDb();
    const embed = vi.fn().mockResolvedValue(embedding);

    await updateBookmarkEmbedding({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider: { embed },
      content: {
        title: "제목",
        description: "설명",
        tags: ["태그"],
      },
    });

    expect(embed).toHaveBeenCalledWith({
      text: "제목\n설명\n태그",
      taskType: "document",
    });
    expect(from).toHaveBeenCalledWith("bookmarks");
    expect(update).toHaveBeenCalledWith({ embedding });
    expect(firstEq).toHaveBeenCalledWith("user_id", "user");
    expect(secondEq).toHaveBeenCalledWith("id", "bookmark");
  });

  it("does nothing when embeddings are disabled", async () => {
    const { db, from } = createDb();

    await updateBookmarkEmbedding({
      db,
      userId: "user",
      bookmarkId: "bookmark",
      provider: null,
      content: { title: "제목", description: null, tags: [] },
    });

    expect(from).not.toHaveBeenCalled();
  });

  it("leaves the bookmark update untouched when generation fails", async () => {
    const { db, update } = createDb();
    const embed = vi.fn().mockRejectedValue(new Error("embedding failed"));

    await expect(
      updateBookmarkEmbedding({
        db,
        userId: "user",
        bookmarkId: "bookmark",
        provider: { embed },
        content: { title: "제목", description: null, tags: [] },
      }),
    ).rejects.toThrow("embedding failed");
    expect(update).not.toHaveBeenCalled();
  });
});
