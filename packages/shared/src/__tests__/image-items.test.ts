import { describe, expect, it } from "vitest";
import {
  bookmarkListQuerySchema,
  bookmarkSchema,
  reminderWithBookmarkSchema,
} from "../index";

const baseBookmark = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  title: "저장한 항목",
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: [],
  aiStatus: "pending",
  aiModel: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
} as const;

describe("image item schemas", () => {
  it("parses link and image bookmark variants", () => {
    expect(
      bookmarkSchema.parse({
        ...baseBookmark,
        kind: "link",
        url: "https://example.com/article",
        image: null,
      }),
    ).toMatchObject({ kind: "link", url: "https://example.com/article" });

    expect(
      bookmarkSchema.parse({
        ...baseBookmark,
        kind: "image",
        url: null,
        image: {
          thumbnailUrl: "https://signed.example/thumbnail",
          originalUrl: null,
          mimeType: "image/heic",
          fileSize: 1024,
          width: 1200,
          height: 900,
          filename: "photo.heic",
        },
      }),
    ).toMatchObject({ kind: "image", url: null });
  });

  it("rejects fields from the other content variant", () => {
    expect(() =>
      bookmarkSchema.parse({
        ...baseBookmark,
        kind: "image",
        url: "https://example.com/not-allowed",
        image: null,
      }),
    ).toThrow();
    expect(() =>
      bookmarkSchema.parse({
        ...baseBookmark,
        kind: "link",
        url: null,
        image: null,
      }),
    ).toThrow();
  });

  it("accepts an optional kind list filter", () => {
    expect(bookmarkListQuerySchema.parse({ kind: "image" })).toMatchObject({
      kind: "image",
    });
    expect(() => bookmarkListQuerySchema.parse({ kind: "video" })).toThrow();
  });

  it("allows reminders to reference an image without a URL", () => {
    expect(
      reminderWithBookmarkSchema.parse({
        id: "33333333-3333-4333-8333-333333333333",
        userId: baseBookmark.userId,
        bookmarkId: baseBookmark.id,
        remindAt: "2026-07-14T10:00:00.000Z",
        note: null,
        status: "pending",
        sentAt: null,
        createdAt: "2026-07-13T10:00:00.000Z",
        bookmark: {
          id: baseBookmark.id,
          kind: "image",
          url: null,
          title: "사진",
        },
      }).bookmark,
    ).toEqual({
      id: baseBookmark.id,
      kind: "image",
      url: null,
      title: "사진",
    });
  });
});
