import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  bookmarkSchema,
  createBookmarkRequestSchema,
} from "../index";

describe("API_ERROR_CODES", () => {
  it("contains the generic internal error code", () => {
    expect(API_ERROR_CODES.INTERNAL).toBe("INTERNAL");
  });
});

describe("domain schemas", () => {
  it("requires categoryId for manual bookmark creation", () => {
    expect(() =>
      createBookmarkRequestSchema.parse({
        url: "https://example.com",
        mode: "manual",
      }),
    ).toThrow();
  });

  it("parses a bookmark response", () => {
    expect(
      bookmarkSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        url: "https://example.com",
        title: null,
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
        categoryId: null,
        aiStatus: "idle",
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z",
      }),
    ).toMatchObject({ url: "https://example.com", aiStatus: "idle" });
  });
});
