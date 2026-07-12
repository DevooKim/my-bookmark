import {
  type Bookmark,
  bookmarkSchema,
  type Category,
  type CategoryWithCount,
  categorySchema,
  categoryWithCountSchema,
  type ReminderWithBookmark,
  reminderWithBookmarkSchema,
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
  tags: string[];
  ai_status: "idle" | "pending" | "done" | "failed";
  ai_model: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryDbRow {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  bookmark_count?: number;
}

interface ReminderWithBookmarkDbRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  created_at: string;
  bookmarks: Pick<BookmarkDbRow, "id" | "url" | "title"> | null;
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
    tags: row.tags,
    aiStatus: row.ai_status,
    aiModel: row.ai_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function mapCategory(row: CategoryDbRow): Category {
  return dbCategorySchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
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

export function mapReminderWithBookmark(
  row: ReminderWithBookmarkDbRow,
): ReminderWithBookmark {
  return reminderWithBookmarkSchema.parse({
    id: row.id,
    userId: row.user_id,
    bookmarkId: row.bookmark_id,
    remindAt: row.remind_at,
    note: row.note,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    bookmark: row.bookmarks,
  });
}
