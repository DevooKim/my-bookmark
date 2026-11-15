import { z } from "zod";

// NAVER API HUB 지역 검색. 공식 문서(api.ncloud-docs.com NAVER API HUB > Search > 지역)와
// 2026-11-15 실측 기준: GET /search/v1/local, display 1~5, 헤더 X-NCP-APIGW-API-KEY(-ID),
// mapx/mapy는 WGS84 경도·위도에 10^7을 곱한 정수 문자열.
const LOCAL_SEARCH_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local";
const REQUEST_TIMEOUT_MS = 5_000;

// 한국 범위. 범위를 벗어나는 좌표는 잘못된 매칭이나 형식 변경으로 보고 채택하지 않는다.
const KOREA_LAT = { min: 33, max: 39 };
const KOREA_LNG = { min: 124, max: 132 };

const localSearchResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      address: z.string().default(""),
      roadAddress: z.string().default(""),
      mapx: z.string(),
      mapy: z.string(),
    }),
  ),
});

export interface GeocodablePlace {
  name: string;
  locality: string | null;
}

export type GeocodeOutcome =
  | {
      status: "resolved";
      lat: number;
      lng: number;
      address: string | null;
      roadAddress: string | null;
    }
  | { status: "not_found" };

export interface PlaceGeocoder {
  // 네트워크·HTTP·응답 형식 오류는 throw한다(호출자가 pending으로 남긴다).
  geocode(place: GeocodablePlace): Promise<GeocodeOutcome>;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

export function stripSearchMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (entity) => {
      return HTML_ENTITIES[entity] ?? entity;
    })
    .trim();
}

function normalizePlaceName(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

export function namesMatch(placeName: string, resultTitle: string): boolean {
  const place = normalizePlaceName(placeName);
  const title = normalizePlaceName(stripSearchMarkup(resultTitle));
  if (place.length === 0 || title.length === 0) {
    return false;
  }
  return title.includes(place) || place.includes(title);
}

function parseDegrees(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.abs(parsed) > 360 ? parsed / 1e7 : parsed;
}

export function parseKoreanCoordinate(
  mapx: string,
  mapy: string,
): { lat: number; lng: number } | null {
  const lng = parseDegrees(mapx);
  const lat = parseDegrees(mapy);
  if (
    lat === null ||
    lng === null ||
    lat < KOREA_LAT.min ||
    lat > KOREA_LAT.max ||
    lng < KOREA_LNG.min ||
    lng > KOREA_LNG.max
  ) {
    return null;
  }
  return { lat, lng };
}

export function createPlaceGeocoder(config: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): PlaceGeocoder {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async geocode(place) {
      const query = [place.name.trim(), place.locality?.trim()]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      const url = `${LOCAL_SEARCH_URL}?query=${encodeURIComponent(query)}&display=5`;
      const response = await fetchImpl(url, {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": config.clientId,
          "X-NCP-APIGW-API-KEY": config.clientSecret,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Naver local search failed with status ${response.status}`,
        );
      }
      const { items } = localSearchResponseSchema.parse(await response.json());
      // 오탐 방지: 이름이 일치하는 첫 항목만 채택하고 name만으로 재검색하지 않는다.
      for (const item of items) {
        if (!namesMatch(place.name, item.title)) {
          continue;
        }
        const coordinate = parseKoreanCoordinate(item.mapx, item.mapy);
        if (!coordinate) {
          continue;
        }
        return {
          status: "resolved",
          ...coordinate,
          address: item.address.trim() || null,
          roadAddress: item.roadAddress.trim() || null,
        };
      }
      return { status: "not_found" };
    },
  };
}
