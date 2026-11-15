import {
  type Bookmark,
  type BookmarkPlace,
  bookmarkPlaceSchema,
  bookmarkSchema,
  buildPlaceMapLink,
  type Category,
  type CategoryWithCount,
  categorySchema,
  categoryWithCountSchema,
  type ReminderWithBookmark,
  reminderWithBookmarkSchema,
} from "@my-bookmark/shared";

const dbCategorySchema = categorySchema.transform((category) => category);

// Keep vector columns out of row payloads used to build API responses.
export const BOOKMARK_DB_COLUMNS =
  "id,user_id,kind,url,title,description,site_name,favicon_url,og_image_url,category_id,tags,metadata,ai_status,ai_model,image_original_path,image_thumbnail_path,image_mime_type,image_file_size,image_width,image_height,image_filename,created_at,updated_at";

export interface BookmarkDbRow {
  id: string;
  user_id: string;
  kind: "link" | "image";
  url: string | null;
  title: string | null;
  description: string | null;
  site_name: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  category_id: string | null;
  tags: string[];
  metadata?: unknown;
  ai_status: "idle" | "pending" | "done" | "failed";
  ai_model: string | null;
  image_original_path: string | null;
  image_thumbnail_path: string | null;
  image_mime_type: string | null;
  image_file_size: number | null;
  image_width: number | null;
  image_height: number | null;
  image_filename: string | null;
  created_at: string;
  updated_at: string;
}

export const BOOKMARK_PLACE_DB_COLUMNS =
  "id,user_id,bookmark_id,position,name,locality,country_code,geocode_status,lat,lng,address,road_address,created_at";

export interface BookmarkPlaceDbRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  position: number;
  name: string;
  locality: string | null;
  country_code: string | null;
  geocode_status: "pending" | "resolved" | "not_found" | "skipped";
  lat: number | null;
  lng: number | null;
  address: string | null;
  road_address: string | null;
  created_at: string;
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
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_timezone: string;
  is_enabled: boolean;
  created_at: string;
  bookmarks: Pick<BookmarkDbRow, "id" | "kind" | "url" | "title"> | null;
}

export function mapBookmarkPlace(row: BookmarkPlaceDbRow): BookmarkPlace {
  const link = buildPlaceMapLink({
    name: row.name,
    locality: row.locality,
    countryCode: row.country_code,
  });
  return bookmarkPlaceSchema.parse({
    id: row.id,
    name: row.name,
    locality: row.locality,
    countryCode: row.country_code,
    lat: row.lat,
    lng: row.lng,
    address: row.road_address ?? row.address,
    mapProvider: link.provider,
    mapUrl: link.url,
  });
}

export function mapBookmark(
  row: BookmarkDbRow,
  media: { thumbnailUrl?: string | null; originalUrl?: string | null } = {},
  places: readonly BookmarkPlace[] = [],
): Bookmark {
  return bookmarkSchema.parse({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    url: row.url,
    image:
      row.kind === "image"
        ? {
            thumbnailUrl: media.thumbnailUrl ?? null,
            originalUrl: media.originalUrl ?? null,
            mimeType: row.image_mime_type,
            fileSize: row.image_file_size,
            width: row.image_width,
            height: row.image_height,
            filename: row.image_filename,
          }
        : null,
    title: row.title,
    description: row.description,
    siteName: row.site_name,
    faviconUrl: row.favicon_url,
    ogImageUrl: row.og_image_url,
    categoryId: row.category_id,
    tags: row.tags,
    metadata: row.metadata ?? {},
    aiStatus: row.ai_status,
    aiModel: row.ai_model,
    places,
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
    recurrence: row.recurrence,
    recurrenceTimezone: row.recurrence_timezone,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    bookmark: row.bookmarks,
  });
}
