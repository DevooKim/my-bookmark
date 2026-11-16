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
