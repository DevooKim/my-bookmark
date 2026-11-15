import {
  API_ERROR_CODES,
  type PlaceGroup,
  placeGroupsResponseSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { z } from "zod";
import { type BookmarkPlaceDbRow, mapBookmarkPlace } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { domainFromUrl } from "../lib/url";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { type ImageStorageBucket, signImage } from "../services/image-storage";

const IMAGE_BUCKET = "bookmark-images";
const PLACE_PAGE_SIZE = 1000;

const PLACE_GROUP_COLUMNS =
  "id,user_id,bookmark_id,position,name,locality,country_code,geocode_status,lat,lng,address,road_address,created_at,bookmarks!inner(id,kind,url,title,image_filename,image_thumbnail_path,created_at)";

const embeddedBookmarkSchema = z.object({
  id: z.string(),
  kind: z.enum(["link", "image"]),
  url: z.string().nullable(),
  title: z.string().nullable(),
  image_filename: z.string().nullable(),
  image_thumbnail_path: z.string().nullable(),
  created_at: z.string(),
});

export type PlaceGroupRow = BookmarkPlaceDbRow & {
  bookmarks: z.infer<typeof embeddedBookmarkSchema>;
};

export interface PlacesDeps {
  // 사용자의 resolved 장소를 북마크 정보와 함께 position 오름차순으로 돌려준다.
  listResolvedPlaces(userId: string): Promise<PlaceGroupRow[]>;
  signThumbnail(path: string): Promise<string | null>;
}

export const placesRouter = createPlacesRouter();

// API Key 허용 경로가 아니므로 Bearer 전용이다.
export function createPlacesRouter(
  deps: PlacesDeps = createSupabasePlacesDeps(),
  auth: RequestHandler = requireAuth(),
): Router {
  const router = Router();
  router.use("/places", auth);
  router.get("/places", async (request, response) => {
    const items = await listPlaceGroupsForUser(getUserId(request), deps);
    response.json(placeGroupsResponseSchema.parse({ items }));
  });
  return router;
}

// 게시글 제목이 없으면 북마크 목록과 같은 폴백을 쓴다.
function fallbackTitle(bookmark: PlaceGroupRow["bookmarks"]): string {
  if (bookmark.title) {
    return bookmark.title;
  }
  if (bookmark.kind === "link") {
    return bookmark.url ? domainFromUrl(bookmark.url) : "제목 없는 링크";
  }
  return bookmark.image_filename ?? "분석 중인 이미지";
}

export async function listPlaceGroupsForUser(
  userId: string,
  deps: PlacesDeps,
): Promise<PlaceGroup[]> {
  const rows = await deps.listResolvedPlaces(userId);
  const groups = new Map<
    string,
    { bookmark: PlaceGroupRow["bookmarks"]; rows: PlaceGroupRow[] }
  >();
  for (const row of rows) {
    // 좌표가 없는 장소는 지도에 올릴 수 없다.
    if (row.lat === null || row.lng === null) {
      continue;
    }
    const group = groups.get(row.bookmark_id) ?? {
      bookmark: row.bookmarks,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.bookmark_id, group);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    b.bookmark.created_at.localeCompare(a.bookmark.created_at),
  );
  return Promise.all(
    ordered.map(async ({ bookmark, rows: placeRows }) => {
      const places = placeRows
        .sort((a, b) => a.position - b.position)
        .map(mapBookmarkPlace);
      if (bookmark.kind === "link") {
        return {
          bookmark: {
            id: bookmark.id,
            kind: "link" as const,
            title: fallbackTitle(bookmark),
            url: bookmark.url ?? "",
            thumbnailUrl: null,
          },
          places,
        };
      }
      const thumbnailUrl = bookmark.image_thumbnail_path
        ? await deps.signThumbnail(bookmark.image_thumbnail_path)
        : null;
      return {
        bookmark: {
          id: bookmark.id,
          kind: "image" as const,
          title: fallbackTitle(bookmark),
          url: null,
          thumbnailUrl,
        },
        places,
      };
    }),
  );
}

export function createSupabasePlacesDeps(): PlacesDeps {
  const getDb = () => {
    if (!supabaseAdmin) {
      throw new HttpError(
        500,
        API_ERROR_CODES.INTERNAL,
        "Database is not configured",
      );
    }
    return supabaseAdmin;
  };
  return {
    async listResolvedPlaces(userId) {
      const db = getDb();
      const rows: PlaceGroupRow[] = [];
      // PostgREST는 응답 행 수를 제한하므로 페이지 단위로 끝까지 읽는다.
      for (let offset = 0; ; offset += PLACE_PAGE_SIZE) {
        const { data, error } = await db
          .from("bookmark_places")
          .select(PLACE_GROUP_COLUMNS)
          .eq("user_id", userId)
          .eq("geocode_status", "resolved")
          .order("bookmark_id", { ascending: true })
          .order("position", { ascending: true })
          .range(offset, offset + PLACE_PAGE_SIZE - 1);
        if (error) {
          throw error;
        }
        const page = (data ?? []).map((row) => {
          const { bookmarks, ...place } =
            row as unknown as BookmarkPlaceDbRow & {
              bookmarks: unknown;
            };
          return {
            ...place,
            bookmarks: embeddedBookmarkSchema.parse(bookmarks),
          };
        });
        rows.push(...page);
        if (page.length < PLACE_PAGE_SIZE) {
          return rows;
        }
      }
    },
    async signThumbnail(path) {
      const storage: ImageStorageBucket = getDb().storage.from(IMAGE_BUCKET);
      return signImage(storage, path).catch(() => {
        console.warn("place group thumbnail signing failed");
        return null;
      });
    },
  };
}
