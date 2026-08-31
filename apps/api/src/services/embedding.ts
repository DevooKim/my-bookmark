import type { EmbeddingProvider as AiEmbeddingProvider } from "@my-bookmark/ai";

export interface BookmarkEmbeddingContent {
  title: string | null;
  description: string | null;
  tags: string[];
}

export function buildEmbeddingText({
  title,
  description,
  tags,
}: BookmarkEmbeddingContent): string {
  return [
    title?.trim(),
    description?.trim(),
    tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(" "),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

interface BookmarkDbTable {
  select?: (...args: never[]) => unknown;
  update?: (...args: never[]) => unknown;
  insert?: (...args: never[]) => unknown;
}

interface BookmarkEmbeddingDb {
  from(table: string): BookmarkDbTable;
}

interface BookmarkEmbeddingTable extends BookmarkDbTable {
  update(values: { embedding: number[] }): {
    eq(
      field: "user_id",
      value: string,
    ): {
      eq(
        field: "id",
        value: string,
      ): PromiseLike<{
        error: { message?: string } | null;
      }>;
    };
  };
}

function isBookmarkEmbeddingTable(
  value: BookmarkDbTable,
): value is BookmarkEmbeddingTable {
  return typeof value.update === "function";
}

export async function updateBookmarkEmbedding(input: {
  db: BookmarkEmbeddingDb;
  userId: string;
  bookmarkId: string;
  provider: AiEmbeddingProvider | null;
  content: BookmarkEmbeddingContent;
}): Promise<void> {
  if (!input.provider) {
    return;
  }

  const embedding = await input.provider.embed({
    text: buildEmbeddingText(input.content),
  });
  const table = input.db.from("bookmarks");
  if (!isBookmarkEmbeddingTable(table)) {
    throw new Error("Bookmark embedding database is unavailable");
  }
  const { error } = await table
    .update({ embedding })
    .eq("user_id", input.userId)
    .eq("id", input.bookmarkId);
  if (error) {
    throw error;
  }
}
