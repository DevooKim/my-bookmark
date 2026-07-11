import type { AiProvider } from "@my-bookmark/ai";
import { domainFromUrl } from "../lib/url";
import { fetchMetadata, type PageMetadata } from "./metadata";

type AnalyzeResult = Awaited<ReturnType<AiProvider["categorize"]>>;

interface DbError {
  code?: string;
  message?: string;
}

interface BookmarkRow {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  ai_status: "idle" | "pending" | "done" | "failed";
}

interface CategoryRow {
  id: string;
  name: string;
}

interface BookmarkCategorizeDb {
  from(table: string): unknown;
}

interface CategorizeOptions {
  db: BookmarkCategorizeDb;
  userId: string;
  bookmarkId: string;
  provider: AiProvider | null;
  metadataFetcher?: (url: string) => Promise<PageMetadata>;
}

export async function categorizeBookmark({
  db,
  userId,
  bookmarkId,
  provider,
  metadataFetcher = fetchMetadata,
}: CategorizeOptions): Promise<void> {
  try {
    const bookmark = await loadBookmark(db, userId, bookmarkId);
    if (!bookmark) {
      return;
    }

    const metadata = await metadataFetcher(bookmark.url);
    const title =
      bookmark.title ?? metadata.title ?? domainFromUrl(bookmark.url);
    const description = metadata.description ?? bookmark.description;
    const siteName = metadata.siteName ?? bookmark.site_name;
    await updateMetadata(db, userId, bookmarkId, {
      title,
      description,
      site_name: siteName,
      favicon_url: metadata.faviconUrl,
      og_image_url: metadata.ogImageUrl,
    });

    if (!provider) {
      await markFailed(db, userId, bookmarkId);
      return;
    }

    const categories = await loadCategories(db, userId);
    const result = await provider.categorize({
      url: bookmark.url,
      title,
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
      existingCategories: categories,
    });
    await applyCategorizeResult(db, userId, bookmarkId, categories, result);
  } catch (error) {
    console.warn("AI categorization failed", error);
    await markFailed(db, userId, bookmarkId).catch((markError) =>
      console.warn("AI failed status update failed", markError),
    );
  }
}

export async function applyCategorizeResult(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
  categories: CategoryRow[],
  result: AnalyzeResult,
): Promise<void> {
  let categoryId: string | null = null;

  if (result.category.type === "existing") {
    const requestedCategoryId = result.category.categoryId;
    const category = categories.find((item) => item.id === requestedCategoryId);
    categoryId = category?.id ?? null;
  } else if (result.category.type === "new") {
    const name = result.category.name.trim();
    const existing = findCategoryByNormalizedName(categories, name);
    const current =
      existing ??
      findCategoryByNormalizedName(await loadCategories(db, userId), name);
    categoryId = current?.id ?? (await createCategory(db, userId, name));
  }

  await markDone(db, userId, bookmarkId, categoryId, result);
}

async function loadBookmark(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkRow | null> {
  const { data, error } = await (db.from("bookmarks") as BookmarkSelectTable)
    .select("id,user_id,url,title,description,site_name,ai_status")
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

async function loadCategories(
  db: BookmarkCategorizeDb,
  userId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await (db.from("categories") as CategorySelectTable)
    .select("id,name")
    .eq("user_id", userId);
  if (error) {
    throw error;
  }
  return data ?? [];
}

async function updateMetadata(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
  values: {
    title: string;
    description: string | null;
    site_name: string | null;
    favicon_url: string | null;
    og_image_url: string | null;
  },
): Promise<void> {
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update(values)
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .eq("ai_status", "pending");
  if (error) {
    throw error;
  }
}

async function markDone(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
  categoryId: string | null,
  result: AnalyzeResult,
): Promise<void> {
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update({
      category_id: categoryId,
      title: result.summaryTitle,
      tags: result.tags,
      ai_status: "done",
    })
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .eq("ai_status", "pending");
  if (error) {
    throw error;
  }
}

async function markFailed(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
): Promise<void> {
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update({ ai_status: "failed" })
    .eq("user_id", userId)
    .eq("id", bookmarkId)
    .eq("ai_status", "pending");
  if (error) {
    throw error;
  }
}

function findCategoryByNormalizedName(
  categories: CategoryRow[],
  name: string,
): CategoryRow | undefined {
  const normalizedName = name.trim().toLowerCase();
  return categories.find(
    (item) => item.name.trim().toLowerCase() === normalizedName,
  );
}

async function createCategory(
  db: BookmarkCategorizeDb,
  userId: string,
  name: string,
): Promise<string> {
  const { data, error } = await (db.from("categories") as CategoryInsertTable)
    .insert({ user_id: userId, name, color: null })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const categories = await loadCategories(db, userId);
      const existing = findCategoryByNormalizedName(categories, name);
      if (existing) {
        return existing.id;
      }
    }
    throw error;
  }
  return data.id;
}

type QueryResult<T> = PromiseLike<{ data: T; error: DbError | null }>;

interface BookmarkSelectTable {
  select(columns: string): {
    eq(
      field: string,
      value: string,
    ): {
      eq(
        field: string,
        value: string,
      ): {
        maybeSingle(): QueryResult<BookmarkRow | null>;
      };
    };
  };
}

interface CategorySelectTable {
  select(columns: string): {
    eq(field: string, value: string): QueryResult<CategoryRow[] | null>;
  };
}

interface BookmarkUpdateTable {
  update(values: Record<string, unknown>): {
    eq(
      field: string,
      value: string,
    ): {
      eq(
        field: string,
        value: string,
      ): {
        eq(field: string, value: string): QueryResult<null>;
      };
    };
  };
}

interface CategoryInsertTable {
  insert(values: Record<string, unknown>): {
    select(columns: string): {
      single(): QueryResult<{ id: string }>;
    };
  };
}
