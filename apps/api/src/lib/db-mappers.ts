import {
  type Bookmark,
  bookmarkSchema,
  type Category,
  categorySchema,
  type CategoryWithCount,
  categoryWithCountSchema,
} from "@my-bookmark/shared";

const dbCategorySchema = categorySchema.transform((category) => category);

interface BookmarkDbRow {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  category_id: string | null;
  ai_status: "idle" | "pending" | "done" | "failed";
  created_at: string;
  updated_at: string;
}

interface CategoryDbRow {
  id: string;
  user_id: string;
  name: string;
  color: Category["color"];
  sort_order: number;
  created_at: string;
  bookmark_count?: number;
}

export function mapBookmark(row: BookmarkDbRow): Bookmark {
  return bookmarkSchema.parse({
    id: row.id,
    userId: row.user_id,
    url: row.url,
    title: row.title,
    description: row.description,
    siteName: row.site_name,
    faviconUrl: row.favicon_url,
    ogImageUrl: row.og_image_url,
    categoryId: row.category_id,
    aiStatus: row.ai_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function mapCategory(row: CategoryDbRow): Category {
  return dbCategorySchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  });
}

export function mapCategoryWithCount(row: CategoryDbRow): CategoryWithCount {
  return categoryWithCountSchema.parse({
    ...mapCategory(row),
    bookmarkCount: row.bookmark_count,
  });
}
