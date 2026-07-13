import { describe, expect, it } from "vitest";
import { bookmarkMetadataSchema, updateBookmarkRequestSchema } from "../index";

describe("bookmark metadata schema", () => {
  it("normalizes string key-value entries", () => {
    expect(
      bookmarkMetadataSchema.parse({
        " 지역 ": " 서울 성수동 ",
        네이버지도: " https://map.naver.com/p/search/test ",
      }),
    ).toEqual({
      지역: "서울 성수동",
      네이버지도: "https://map.naver.com/p/search/test",
    });
    expect(bookmarkMetadataSchema.parse({})).toEqual({});
  });

  it("rejects entries outside the size limits", () => {
    expect(() =>
      bookmarkMetadataSchema.parse(
        Object.fromEntries(
          Array.from({ length: 11 }, (_, index) => [`key-${index}`, "value"]),
        ),
      ),
    ).toThrow();
    expect(() => bookmarkMetadataSchema.parse({ " ": "value" })).toThrow();
    expect(() => bookmarkMetadataSchema.parse({ key: " " })).toThrow();
    expect(() =>
      bookmarkMetadataSchema.parse({ ["가".repeat(41)]: "value" }),
    ).toThrow();
    expect(() =>
      bookmarkMetadataSchema.parse({ key: "가".repeat(2049) }),
    ).toThrow();
  });

  it.each([
    "__proto__",
    "prototype",
    "constructor",
  ])("rejects the reserved key %s", (key) => {
    expect(() =>
      bookmarkMetadataSchema.parse(JSON.parse(`{"${key}":"value"}`)),
    ).toThrow();
  });

  it("normalizes metadata in bookmark updates", () => {
    expect(
      updateBookmarkRequestSchema.parse({ metadata: { " 장소 ": " 성수 " } }),
    ).toEqual({ metadata: { 장소: "성수" } });
  });
});
