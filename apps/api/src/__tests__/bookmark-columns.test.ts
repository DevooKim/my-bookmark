import { expect, it } from "vitest";
import { BOOKMARK_DB_COLUMNS, type BookmarkDbRow } from "../lib/db-mappers";

const bookmarkDbRowKeys = [
  "id",
  "user_id",
  "kind",
  "url",
  "title",
  "description",
  "site_name",
  "favicon_url",
  "og_image_url",
  "category_id",
  "tags",
  "metadata",
  "ai_status",
  "ai_model",
  "image_original_path",
  "image_thumbnail_path",
  "image_mime_type",
  "image_file_size",
  "image_width",
  "image_height",
  "image_filename",
  "created_at",
  "updated_at",
] satisfies readonly (keyof BookmarkDbRow)[];

type MissingBookmarkColumns = Exclude<
  keyof BookmarkDbRow,
  (typeof bookmarkDbRowKeys)[number]
>;
type ExtraBookmarkColumns = Exclude<
  (typeof bookmarkDbRowKeys)[number],
  keyof BookmarkDbRow
>;
type BookmarkColumnsAreExact = [
  MissingBookmarkColumns,
  ExtraBookmarkColumns,
] extends [never, never]
  ? true
  : false;

const bookmarkColumnsAreExact: BookmarkColumnsAreExact = true;

it("keeps the response column list exactly synchronized with BookmarkDbRow", () => {
  expect(bookmarkColumnsAreExact).toBe(true);
  const selectedColumns = BOOKMARK_DB_COLUMNS.split(",");
  expect(selectedColumns).toHaveLength(bookmarkDbRowKeys.length);
  expect(new Set(selectedColumns).size).toBe(selectedColumns.length);
  expect(selectedColumns).toEqual(bookmarkDbRowKeys);
  expect(selectedColumns).not.toContain("embedding");
});
