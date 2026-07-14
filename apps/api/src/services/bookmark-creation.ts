import {
  API_ERROR_CODES,
  type Bookmark,
  type CreateBookmarkRequest,
} from "@my-bookmark/shared";
import { type BookmarkDbRow, mapBookmark } from "../lib/db-mappers";
import { normalizeBookmarkUrl } from "../lib/url";
import { HttpError } from "../middleware/error";

interface DbError {
  code?: string;
  message?: string;
}

export interface LinkBookmarkCreationDeps {
  assertCategory(userId: string, categoryId: string): Promise<void>;
  insert(input: {
    userId: string;
    url: string;
    title: string | null;
    categoryId: string | null;
    aiStatus: "pending" | "idle";
  }): Promise<BookmarkDbRow>;
  existingId(userId: string, url: string): Promise<string | undefined>;
  categorize(userId: string, bookmarkId: string): Promise<void>;
  updateMetadata(input: {
    userId: string;
    bookmarkId: string;
    url: string;
    title: string | null;
  }): Promise<void>;
}

export async function createLinkBookmark(
  input: { userId: string; request: CreateBookmarkRequest },
  deps: LinkBookmarkCreationDeps,
): Promise<Bookmark> {
  const { userId, request } = input;
  const url = normalizeBookmarkUrl(request.url);
  if (request.mode === "manual") {
    await deps.assertCategory(userId, request.categoryId);
  }

  let row: BookmarkDbRow;
  try {
    row = await deps.insert({
      userId,
      url,
      title: request.title ?? null,
      categoryId: request.mode === "manual" ? request.categoryId : null,
      aiStatus: request.mode === "ai" ? "pending" : "idle",
    });
  } catch (error) {
    if ((error as DbError).code === "23505") {
      throw new HttpError(409, API_ERROR_CODES.CONFLICT, "이미 저장된 링크", {
        existingId: await deps.existingId(userId, url),
      });
    }
    throw error;
  }

  const bookmark = mapBookmark(row);
  if (request.mode === "ai") {
    void deps
      .categorize(userId, bookmark.id)
      .catch((error) => console.warn("AI categorization task failed", error));
  } else {
    void deps.updateMetadata({
      userId,
      bookmarkId: bookmark.id,
      url,
      title: request.title ?? null,
    });
  }
  return bookmark;
}
