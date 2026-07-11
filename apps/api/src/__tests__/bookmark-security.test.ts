import { API_ERROR_CODES } from "@my-bookmark/shared";
import { describe, expect, it, vi } from "vitest";
import {
  assertCategoryBelongsToUser,
  categorizeBookmarkForUser,
  updateBookmarkMetadata,
} from "../routes/bookmarks";

const userId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const bookmarkId = "33333333-3333-4333-8333-333333333333";

function createCategoryDb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, string]> = [];
  const builder = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn((field: string, value: string) => {
      calls.push([field, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
  };
  return { db: builder, calls };
}

function createBookmarkUpdateDb(result: { error: unknown } = { error: null }) {
  const calls: Array<[string, string]> = [];
  const builder = {
    from: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn((field: string, value: string) => {
      calls.push([field, value]);
      return calls.length >= 2 ? Promise.resolve(result) : builder;
    }),
  };
  return { db: builder, calls, result };
}

describe("bookmark route security helpers", () => {
  it("rejects a category id that does not belong to the current user", async () => {
    const { db, calls } = createCategoryDb({ data: null, error: null });

    await expect(
      assertCategoryBelongsToUser(db, userId, categoryId),
    ).rejects.toMatchObject({
      status: 400,
      code: API_ERROR_CODES.VALIDATION_ERROR,
    });

    expect(calls).toEqual([
      ["user_id", userId],
      ["id", categoryId],
    ]);
  });

  it("resolves the AI provider for the authenticated user", async () => {
    const provider = { name: "fake", categorize: vi.fn() };
    const providerResolver = vi.fn().mockResolvedValue(provider);
    const categorize = vi.fn().mockResolvedValue(undefined);
    const db = { from: vi.fn() };

    await categorizeBookmarkForUser({
      db,
      userId,
      bookmarkId,
      providerResolver,
      categorize,
    });

    expect(providerResolver).toHaveBeenCalledWith(userId);
    expect(categorize).toHaveBeenCalledWith({
      db,
      userId,
      bookmarkId,
      provider,
    });
  });

  it("continues categorization without a provider when credentials cannot be decrypted", async () => {
    const providerResolver = vi
      .fn()
      .mockRejectedValue(new Error("decrypt failed"));
    const categorize = vi.fn().mockResolvedValue(undefined);
    const db = { from: vi.fn() };

    await categorizeBookmarkForUser({
      db,
      userId,
      bookmarkId,
      providerResolver,
      categorize,
    });

    expect(categorize).toHaveBeenCalledWith({
      db,
      userId,
      bookmarkId,
      provider: null,
    });
  });

  it("updates bookmark metadata with both bookmark id and user id filters", async () => {
    const { db, calls } = createBookmarkUpdateDb();

    await updateBookmarkMetadata(
      db,
      userId,
      bookmarkId,
      "https://example.com",
      null,
      async () => ({
        title: "Example",
        description: null,
        siteName: null,
        faviconUrl: null,
        ogImageUrl: null,
      }),
    );

    expect(calls).toContainEqual(["id", bookmarkId]);
    expect(calls).toContainEqual(["user_id", userId]);
  });
});
