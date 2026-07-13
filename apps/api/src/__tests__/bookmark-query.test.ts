import { expect, it } from "vitest";
import { buildBookmarkSearchParams } from "../routes/bookmarks";

it("passes the content kind with the existing bookmark filters", () => {
  expect(
    buildBookmarkSearchParams(
      "11111111-1111-4111-8111-111111111111",
      {
        kind: "image",
        categoryId: "none",
        q: "포스터",
        limit: 30,
      },
      null,
    ),
  ).toEqual({
    p_user_id: "11111111-1111-4111-8111-111111111111",
    p_query: "포스터",
    p_category_id: null,
    p_uncategorized: true,
    p_kind: "image",
    p_cursor_created_at: null,
    p_cursor_id: null,
    p_limit: 31,
  });
});
