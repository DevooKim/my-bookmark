import type { PlaceCandidate } from "@my-bookmark/ai";
import { isDomesticPlace } from "@my-bookmark/shared";
import type { PlaceGeocoder } from "./place-geocoder";

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

export interface GeocodeRow {
  id: string;
  user_id: string;
  name: string;
  locality: string | null;
}

export interface GeocodeSummary {
  resolved: number;
  notFound: number;
  failed: number;
}

interface PlaceUpdateTable {
  update(values: Record<string, unknown>): {
    eq(
      field: string,
      value: string,
    ): {
      eq(field: string, value: string): QueryResult<null>;
    };
  };
}

// 요청은 순차 실행한다(초당 호출 제한 대비). 조회·저장 실패는 해당 행을 pending으로
// 남기고 다음 행으로 넘어간다 — 분석 결과에는 영향을 주지 않는다.
export async function geocodePlaceRows(
  db: PlacesDb,
  rows: readonly GeocodeRow[],
  geocoder: PlaceGeocoder,
): Promise<GeocodeSummary> {
  const summary: GeocodeSummary = { resolved: 0, notFound: 0, failed: 0 };
  for (const row of rows) {
    try {
      const outcome = await geocoder.geocode({
        name: row.name,
        locality: row.locality,
      });
      const values =
        outcome.status === "resolved"
          ? {
              geocode_status: "resolved",
              lat: outcome.lat,
              lng: outcome.lng,
              address: outcome.address,
              road_address: outcome.roadAddress,
            }
          : { geocode_status: "not_found" };
      const { error } = await (db.from("bookmark_places") as PlaceUpdateTable)
        .update(values)
        .eq("id", row.id)
        .eq("user_id", row.user_id);
      if (error) {
        throw error;
      }
      if (outcome.status === "resolved") {
        summary.resolved += 1;
      } else {
        summary.notFound += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.warn("place geocoding failed", { placeId: row.id, error });
    }
  }
  return summary;
}
