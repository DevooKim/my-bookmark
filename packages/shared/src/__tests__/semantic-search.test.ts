import { describe, expect, it } from "vitest";
import { semanticBookmarkSearchQuerySchema } from "../index";

describe("semantic bookmark search query", () => {
  it("trims the query and applies the default result limit", () => {
    expect(semanticBookmarkSearchQuerySchema.parse({ q: "  맛집  " })).toEqual({
      q: "맛집",
      limit: 20,
    });
  });

  it("rejects an empty query and invalid limits", () => {
    expect(() =>
      semanticBookmarkSearchQuerySchema.parse({ q: "   " }),
    ).toThrow();
    expect(() =>
      semanticBookmarkSearchQuerySchema.parse({ q: "맛집", limit: 0 }),
    ).toThrow();
    expect(() =>
      semanticBookmarkSearchQuerySchema.parse({ q: "맛집", limit: 101 }),
    ).toThrow();
  });
});
