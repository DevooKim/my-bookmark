import type { AiProvider, AnalyzeResult } from "@my-bookmark/ai";
import { PRESET_MODEL } from "@my-bookmark/ai";
import { domainFromUrl } from "../lib/url";
import { fetchMetadata, type PageMetadata } from "./metadata";

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

export interface AiUsageEventInput {
  provider: string;
  model: string;
  bookmarkId: string | null;
  status: "success" | "failed";
  errorCode: string | null;
  durationMs: number;
  isByok: boolean | null;
}

interface CategorizeOptions {
  db: BookmarkCategorizeDb;
  userId: string;
  bookmarkId: string;
  provider: AiProvider | null;
  recordUsage?: (event: AiUsageEventInput) => Promise<void>;
  metadataFetcher?: (url: string) => Promise<PageMetadata>;
}

// 성공한 모델 id의 vendor prefix를 provider 컬럼에 기록한다
// ("google/gemini-..." -> "google"). 실패 시엔 어떤 모델이 시도됐는지
// OpenRouter가 알려주지 않으므로 고정값 "openrouter"를 사용한다.
function vendorOf(model: string): string {
  return model.split("/")[0] || "openrouter";
}

export async function categorizeBookmark({
  db,
  userId,
  bookmarkId,
  provider,
  recordUsage,
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
    const input = {
      url: bookmark.url,
      title,
      ...(description ? { description } : {}),
      ...(siteName ? { siteName } : {}),
      existingCategories: categories,
    };

    const startedAt = Date.now();
    try {
      const outcome = await provider.categorize(input);
      await recordUsage?.({
        provider: vendorOf(outcome.model),
        model: outcome.model,
        bookmarkId,
        status: "success",
        errorCode: null,
        durationMs: Date.now() - startedAt,
        isByok: outcome.isByok,
      });
      await applyCategorizeResult(
        db,
        userId,
        bookmarkId,
        categories,
        outcome.analysis,
        outcome.model,
      );
    } catch (error) {
      console.warn("AI categorization request failed", error);
      await recordUsage?.({
        provider: "openrouter",
        model: PRESET_MODEL,
        bookmarkId,
        status: "failed",
        errorCode: extractErrorCode(error),
        durationMs: Date.now() - startedAt,
        isByok: null,
      });
      await markFailed(db, userId, bookmarkId);
    }
  } catch (error) {
    console.warn("AI categorization failed", error);
    await markFailed(db, userId, bookmarkId).catch((markError) =>
      console.warn("AI failed status update failed", markError),
    );
  }
}

function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return String(status);
    }
    if (error instanceof Error && error.name !== "Error") {
      return error.name.slice(0, 40);
    }
  }
  return "unknown";
}

export async function applyCategorizeResult(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
  categories: CategoryRow[],
  result: AnalyzeResult,
  aiModel: string,
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

  await markDone(db, userId, bookmarkId, categoryId, result, aiModel);
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
  aiModel: string,
): Promise<void> {
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update({
      category_id: categoryId,
      title: result.summaryTitle,
      ...(result.summary ? { description: result.summary } : {}),
      tags: result.tags,
      ai_status: "done",
      ai_model: aiModel,
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

// AI는 "💻 개발"처럼 이모지 접두 이름을 제안하므로, 중복 판정은
// 선두의 비문자(이모지·기호) 부분을 제거한 뒤 비교한다.
function normalizeCategoryName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const stripped = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
}

function findCategoryByNormalizedName(
  categories: CategoryRow[],
  name: string,
): CategoryRow | undefined {
  const normalizedName = normalizeCategoryName(name);
  return categories.find(
    (item) => normalizeCategoryName(item.name) === normalizedName,
  );
}

async function createCategory(
  db: BookmarkCategorizeDb,
  userId: string,
  name: string,
): Promise<string> {
  const { data, error } = await (db.from("categories") as CategoryInsertTable)
    .insert({ user_id: userId, name })
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
