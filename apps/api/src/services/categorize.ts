import type { AiProvider, AnalyzeResult } from "@my-bookmark/ai";
import { PRESET_MODEL } from "@my-bookmark/ai";
import { bookmarkMetadataSchema } from "@my-bookmark/shared";
import { domainFromUrl } from "../lib/url";
import { fetchMetadata, type PageMetadata } from "./metadata";
import { buildSourceMetadataEntry } from "./source-link";

interface DbError {
  code?: string;
  message?: string;
}

interface BookmarkRow {
  id: string;
  user_id: string;
  kind: "link" | "image";
  url: string | null;
  image_original_path: string | null;
  title: string | null;
  description: string | null;
  site_name: string | null;
  metadata: unknown;
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
  imageLoader?: (input: { originalPath: string }) => Promise<{
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    base64: string;
  }>;
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
  imageLoader,
}: CategorizeOptions): Promise<void> {
  try {
    const bookmark = await loadBookmark(db, userId, bookmarkId);
    if (!bookmark) {
      return;
    }

    let linkMetadata:
      | { title: string; description: string | null; siteName: string | null }
      | undefined;
    if (bookmark.kind === "link") {
      if (!bookmark.url) {
        throw new Error("Link bookmark is missing its URL");
      }
      const metadata = await metadataFetcher(bookmark.url);
      linkMetadata = {
        title: bookmark.title ?? metadata.title ?? domainFromUrl(bookmark.url),
        description: metadata.description ?? bookmark.description,
        siteName: metadata.siteName ?? bookmark.site_name,
      };
      await updateMetadata(db, userId, bookmarkId, {
        title: linkMetadata.title,
        description: linkMetadata.description,
        site_name: linkMetadata.siteName,
        favicon_url: metadata.faviconUrl,
        og_image_url: metadata.ogImageUrl,
      });
    }

    if (!provider) {
      await markFailed(db, userId, bookmarkId);
      return;
    }

    const categories = await loadCategories(db, userId);
    let input: Parameters<AiProvider["categorize"]>[0];
    if (bookmark.kind === "image") {
      if (!bookmark.image_original_path || !imageLoader) {
        throw new Error("Image bookmark cannot be loaded for analysis");
      }
      input = {
        kind: "image",
        image: await imageLoader({
          originalPath: bookmark.image_original_path,
        }),
        existingCategories: categories,
      };
    } else {
      if (!bookmark.url || !linkMetadata) {
        throw new Error("Link bookmark metadata is missing");
      }
      input = {
        kind: "link",
        url: bookmark.url,
        title: linkMetadata.title,
        ...(linkMetadata.description
          ? { description: linkMetadata.description }
          : {}),
        ...(linkMetadata.siteName ? { siteName: linkMetadata.siteName } : {}),
        existingCategories: categories,
      };
    }

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
        bookmarkMetadataSchema.parse(bookmark.metadata ?? {}),
        bookmark.kind,
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
  currentMetadata: Record<string, string> = {},
  bookmarkKind: "link" | "image" = "link",
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

  let metadata: Record<string, string> | undefined;
  let mergedMetadata = currentMetadata;
  if (result.place && result.place.confidence >= 0.85) {
    const query = [result.place.name.trim(), result.place.locality?.trim()]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    if (query.length > 0) {
      const parsed = bookmarkMetadataSchema.safeParse({
        ...mergedMetadata,
        네이버지도: `https://map.naver.com/p/search/${encodeURIComponent(query)}`,
      });
      if (parsed.success) {
        mergedMetadata = parsed.data;
        metadata = parsed.data;
      } else {
        console.warn("Generated metadata merge failed", {
          bookmarkId,
          stage: "naver-map",
        });
      }
    }
  }

  if (bookmarkKind === "image") {
    const source = buildSourceMetadataEntry(result.source);
    if (source) {
      const parsed = bookmarkMetadataSchema.safeParse({
        ...mergedMetadata,
        [source.key]: source.value,
      });
      if (parsed.success) {
        mergedMetadata = parsed.data;
        metadata = parsed.data;
      } else {
        console.warn("Generated metadata merge failed", {
          bookmarkId,
          stage: "source-link",
        });
      }
    }
  }

  await markDone(db, userId, bookmarkId, categoryId, result, aiModel, metadata);
}

async function loadBookmark(
  db: BookmarkCategorizeDb,
  userId: string,
  bookmarkId: string,
): Promise<BookmarkRow | null> {
  const { data, error } = await (db.from("bookmarks") as BookmarkSelectTable)
    .select(
      "id,user_id,kind,url,image_original_path,title,description,site_name,metadata,ai_status",
    )
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
  metadata?: Record<string, string>,
): Promise<void> {
  const { error } = await (db.from("bookmarks") as BookmarkUpdateTable)
    .update({
      category_id: categoryId,
      title: result.summaryTitle,
      ...(result.summary ? { description: result.summary } : {}),
      tags: result.tags,
      ...(metadata ? { metadata } : {}),
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
