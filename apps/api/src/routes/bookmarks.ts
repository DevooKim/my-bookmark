import {
  API_ERROR_CODES,
  bookmarkListQuerySchema,
  createBookmarkRequestSchema,
  updateBookmarkRequestSchema,
  uuidSchema,
} from "@my-bookmark/shared";
import { Router } from "express";
import { mapBookmark } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { domainFromUrl, normalizeBookmarkUrl } from "../lib/url";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { getAiProvider } from "../services/ai-provider";
import { createAiUsageRecorder } from "../services/ai-usage";
import { categorizeBookmark } from "../services/categorize";
import { fetchMetadata, type PageMetadata } from "../services/metadata";

interface DbError {
  code?: string;
  message?: string;
}

interface CategoryLookupDb {
  from(table: "categories"): {
    select(columns: string): {
      eq(
        field: string,
        value: string,
      ): {
        eq(
          field: string,
          value: string,
        ): {
          maybeSingle(): PromiseLike<{
            data: { id: string } | null;
            error: DbError | null;
          }>;
        };
      };
    };
  };
}

interface MetadataUpdateDb {
  from(table: "bookmarks"): {
    update(values: {
      title: string;
      description: string | null;
      site_name: string | null;
      favicon_url: string | null;
      og_image_url: string | null;
    }): {
      eq(
        field: string,
        value: string,
      ): {
        eq(
          field: string,
          value: string,
        ): PromiseLike<{ error: DbError | null }>;
      };
    };
  };
}

interface BookmarkUpdate {
  url?: string;
  title?: string | null;
  description?: string | null;
  category_id?: string | null;
  tags?: string[];
  ai_status?: "idle";
}

export const bookmarksRouter = Router();

bookmarksRouter.use("/bookmarks", requireAuth({ apiKey: true }));

bookmarksRouter.post("/bookmarks", async (request, response) => {
  const userId = getUserId(request);
  const body = createBookmarkRequestSchema.parse(request.body);
  const url = normalizeBookmarkUrl(body.url);
  const db = getDb();
  if (body.mode === "manual") {
    await assertCategoryBelongsToUser(db, userId, body.categoryId);
  }

  const insert = {
    user_id: userId,
    url,
    title: body.title ?? null,
    category_id: body.mode === "manual" ? body.categoryId : null,
    ai_status: body.mode === "ai" ? "pending" : "idle",
  };

  const { data, error } = await db
    .from("bookmarks")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    await handleBookmarkInsertError(error, userId, url);
  }

  const bookmark = mapBookmark(data);
  if (body.mode === "ai") {
    void categorizeBookmarkForUser({
      db,
      userId,
      bookmarkId: bookmark.id,
    }).catch((error) => console.warn("AI categorization task failed", error));
  } else {
    void updateBookmarkMetadata(
      db,
      userId,
      bookmark.id,
      url,
      body.title ?? null,
    );
  }
  response.status(201).json({ bookmark });
});

bookmarksRouter.post("/bookmarks/:id/categorize", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const db = getDb();
  const { data, error } = await db
    .from("bookmarks")
    .update({ ai_status: "pending" })
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found");
  }
  const bookmark = mapBookmark(data);
  void categorizeBookmarkForUser({
    db,
    userId,
    bookmarkId: bookmark.id,
  }).catch((taskError) =>
    console.warn("AI categorization task failed", taskError),
  );
  response.json({ bookmark });
});

bookmarksRouter.get("/bookmarks", async (request, response) => {
  const userId = getUserId(request);
  const query = bookmarkListQuerySchema.parse(request.query);
  const db = getDb();
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const { data, error } = await db.rpc("search_bookmarks", {
    p_user_id: userId,
    p_query: query.q ?? null,
    p_category_id:
      query.categoryId && query.categoryId !== "none" ? query.categoryId : null,
    p_uncategorized: query.categoryId === "none",
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: query.limit + 1,
  });
  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const pageRows = rows.slice(0, query.limit);
  const next = rows.length > query.limit ? pageRows.at(-1) : undefined;
  response.json({
    items: pageRows.map(mapBookmark),
    nextCursor: next ? encodeCursor(next.created_at, next.id) : null,
  });
});

bookmarksRouter.get("/bookmarks/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const { data, error } = await getDb()
    .from("bookmarks")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found");
  }
  response.json({ bookmark: mapBookmark(data) });
});

bookmarksRouter.patch("/bookmarks/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const body = updateBookmarkRequestSchema.parse(request.body);
  const updates: BookmarkUpdate = {};
  if (body.url !== undefined) {
    updates.url = normalizeBookmarkUrl(body.url);
  }
  if (body.title !== undefined) {
    updates.title = body.title;
  }
  if (body.description !== undefined) {
    updates.description = body.description;
  }
  if (body.tags !== undefined) {
    updates.tags = body.tags;
  }
  const db = getDb();
  if (body.categoryId !== undefined) {
    if (body.categoryId !== null) {
      await assertCategoryBelongsToUser(db, userId, body.categoryId);
    }
    updates.category_id = body.categoryId;
    updates.ai_status = "idle";
  }

  const { data, error } = await db
    .from("bookmarks")
    .update(updates)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    await handleBookmarkInsertError(error, userId, updates.url ?? "");
  }
  if (!data) {
    throw new HttpError(404, API_ERROR_CODES.NOT_FOUND, "Bookmark not found");
  }
  response.json({ bookmark: mapBookmark(data) });
});

bookmarksRouter.delete("/bookmarks/:id", async (request, response) => {
  const userId = getUserId(request);
  const id = uuidSchema.parse(request.params.id);
  const { error } = await getDb()
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) {
    throw error;
  }
  response.status(204).send();
});

function getDb() {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  return supabaseAdmin;
}

async function handleBookmarkInsertError(
  error: { code?: string; message?: string },
  userId: string,
  url: string,
): Promise<never> {
  if (error.code === "23505") {
    const { data } = await getDb()
      .from("bookmarks")
      .select("id")
      .eq("user_id", userId)
      .eq("url", url)
      .maybeSingle();
    throw new HttpError(409, API_ERROR_CODES.CONFLICT, "이미 저장된 링크", {
      existingId: data?.id,
    });
  }
  throw error;
}

interface CategorizeBookmarkForUserOptions {
  db: Parameters<typeof categorizeBookmark>[0]["db"];
  userId: string;
  bookmarkId: string;
  providerResolver?: typeof getAiProvider;
  categorize?: typeof categorizeBookmark;
}

export async function categorizeBookmarkForUser({
  db,
  userId,
  bookmarkId,
  providerResolver = getAiProvider,
  categorize = categorizeBookmark,
}: CategorizeBookmarkForUserOptions): Promise<void> {
  await categorize({
    db,
    userId,
    bookmarkId,
    provider: providerResolver(),
    recordUsage: createAiUsageRecorder(db, userId),
  });
}

export async function assertCategoryBelongsToUser(
  db: unknown,
  userId: string,
  categoryId: string,
): Promise<void> {
  const categoryDb = db as CategoryLookupDb;
  const { data, error } = await categoryDb
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .eq("id", categoryId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "categoryId must reference one of your categories",
    );
  }
}

export async function updateBookmarkMetadata(
  db: unknown,
  userId: string,
  bookmarkId: string,
  url: string,
  providedTitle: string | null,
  metadataFetcher: (url: string) => Promise<PageMetadata> = fetchMetadata,
): Promise<void> {
  try {
    const metadata = await metadataFetcher(url);
    const metadataDb = db as MetadataUpdateDb;
    const { error } = await metadataDb
      .from("bookmarks")
      .update({
        title: providedTitle ?? metadata.title ?? domainFromUrl(url),
        description: metadata.description,
        site_name: metadata.siteName,
        favicon_url: metadata.faviconUrl,
        og_image_url: metadata.ogImageUrl,
      })
      .eq("id", bookmarkId)
      .eq("user_id", userId);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("metadata update failed", error);
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return {
      createdAt: String(parsed.createdAt),
      id: uuidSchema.parse(parsed.id),
    };
  } catch {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "Invalid cursor",
    );
  }
}
