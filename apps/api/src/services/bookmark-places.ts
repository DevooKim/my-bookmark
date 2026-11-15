import type { PlaceCandidate } from "@my-bookmark/ai";
import { type BookmarkPlace, isDomesticPlace } from "@my-bookmark/shared";
import {
  BOOKMARK_PLACE_DB_COLUMNS,
  type BookmarkPlaceDbRow,
  mapBookmarkPlace,
} from "../lib/db-mappers";

interface DbError {
  code?: string;
  message?: string;
}

type QueryResult<T> = PromiseLike<{ data: T; error: DbError | null }>;

export interface PlacesDb {
  from(table: string): unknown;
}

export const PLACE_CONFIDENCE_THRESHOLD = 0.85;

function normalizePlaceIdentity(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

// 신뢰도 미달 장소를 버리고, 공백·기호·대소문자를 무시한 이름이 같은 항목은
// 첫 번째만 남긴다. 원래 순서를 유지한다.
export function selectPlaceCandidates(
  candidates: readonly PlaceCandidate[] | null | undefined,
): PlaceCandidate[] {
  const seen = new Set<string>();
  const selected: PlaceCandidate[] = [];
  for (const candidate of candidates ?? []) {
    if (candidate.confidence < PLACE_CONFIDENCE_THRESHOLD) {
      continue;
    }
    const identity = normalizePlaceIdentity(candidate.name);
    if (identity.length === 0 || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    selected.push(candidate);
  }
  return selected;
}

interface PlaceSelectTable {
  select(columns: string): {
    eq(
      field: string,
      value: string,
    ): {
      in(
        field: string,
        values: string[],
      ): {
        order(
          field: string,
          options: { ascending: boolean },
        ): QueryResult<BookmarkPlaceDbRow[] | null>;
      };
    };
  };
}

// 목록의 N+1을 피하기 위해 북마크 id 묶음 하나로 장소를 조회한다.
export async function loadPlacesByBookmarkId(
  db: PlacesDb,
  userId: string,
  bookmarkIds: readonly string[],
): Promise<Map<string, BookmarkPlace[]>> {
  const grouped = new Map<string, BookmarkPlace[]>();
  if (bookmarkIds.length === 0) {
    return grouped;
  }
  const { data, error } = await (db.from("bookmark_places") as PlaceSelectTable)
    .select(BOOKMARK_PLACE_DB_COLUMNS)
    .eq("user_id", userId)
    .in("bookmark_id", [...bookmarkIds])
    .order("position", { ascending: true });
  if (error) {
    throw error;
  }
  for (const row of data ?? []) {
    const places = grouped.get(row.bookmark_id) ?? [];
    places.push(mapBookmarkPlace(row));
    grouped.set(row.bookmark_id, places);
  }
  return grouped;
}

interface PlaceDeleteTable {
  delete(): {
    eq(
      field: string,
      value: string,
    ): {
      eq(field: string, value: string): QueryResult<null>;
    };
  };
}

interface PlaceInsertTable {
  insert(values: Record<string, unknown>[]): QueryResult<null>;
}

// 게시물의 장소를 통째로 교체한다. 해외 장소는 좌표 조회 대상이 아니므로
// skipped, 국내(KR 또는 미상)는 pending으로 넣는다.
export async function replaceBookmarkPlaces(
  db: PlacesDb,
  userId: string,
  bookmarkId: string,
  places: readonly PlaceCandidate[],
): Promise<void> {
  const { error: deleteError } = await (
    db.from("bookmark_places") as PlaceDeleteTable
  )
    .delete()
    .eq("user_id", userId)
    .eq("bookmark_id", bookmarkId);
  if (deleteError) {
    throw deleteError;
  }
  if (places.length === 0) {
    return;
  }
  const { error } = await (
    db.from("bookmark_places") as PlaceInsertTable
  ).insert(
    places.map((place, position) => ({
      user_id: userId,
      bookmark_id: bookmarkId,
      position,
      name: place.name,
      locality: place.locality,
      country_code: place.countryCode,
      geocode_status: isDomesticPlace(place) ? "pending" : "skipped",
    })),
  );
  if (error) {
    throw error;
  }
}
