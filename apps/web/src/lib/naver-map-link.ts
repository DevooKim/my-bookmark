import type { BookmarkPlace } from "@my-bookmark/shared";

export const NAVER_APP_FALLBACK_MS = 1500;

type LinkablePlace = Pick<
  BookmarkPlace,
  "name" | "locality" | "address" | "lat" | "lng" | "mapUrl"
>;

export interface NaverMapOpenEnv {
  userAgent: string;
  host: string;
  navigate(url: string): void;
  openTab(url: string): void;
  visibilityState(): DocumentVisibilityState;
  setTimer(callback: () => void, milliseconds: number): void;
}

export function isMobileUserAgent(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(userAgent);
}

const PROVINCE_CITY = /(특별시|광역시|특별자치시)$/;
const REGION_SUFFIX = /[시군구]$/;

// 주소 앞쪽에서 검색어에 쓸 시·군·구를 뽑는다. 광역 단위(서울특별시, 부산광역시, 경기도 …)는 건너뛰고
// 서울특별시 마포구 → 마포구, 경기도 평택시 → 평택시, 경기도 수원시 영통구 → 수원시 영통구.
// 세종특별자치시처럼 아래 단위가 없으면 그 시 이름을 그대로 쓴다. 뽑지 못하면 null이다.
export function extractCityDistrict(
  address: string | null | undefined,
): string | null {
  const tokens = (address ?? "").trim().split(/\s+/).slice(0, 3);
  const regions = tokens.filter((token) => REGION_SUFFIX.test(token));
  const lower = regions.filter((token) => !PROVINCE_CITY.test(token));
  const first = lower[0];
  if (first) {
    // 일반구가 있는 시(수원시 영통구)는 두 단위를 함께 쓴다.
    const second = lower[1];
    return first.endsWith("시") && second?.endsWith("구")
      ? `${first} ${second}`
      : first;
  }
  return regions[0] ?? null;
}

// 앱 검색어: 동명 지점을 줄이도록 장소 이름 + 주소의 시·군·구. 주소에서 못 뽑으면 locality,
// 그것도 없으면 이름만 쓴다. 이미 이름에 들어 있는 지역은 반복하지 않는다.
export function buildNaverSearchQuery(
  place: Pick<LinkablePlace, "name" | "address" | "locality">,
): string {
  const name = place.name.trim();
  const region = extractCityDistrict(place.address) ?? place.locality?.trim();
  return region && !name.includes(region) ? `${name} ${region}` : name;
}

// 공식 URL Scheme의 place 액션은 좌표에 마커만 표시할 뿐 가게 상세(리뷰·영업시간)를 열지 않는다.
// 검색 액션은 앱에서 직접 검색한 것과 같은 결과를 보여 준다.
export function buildNaverAppUrl(
  place: Pick<LinkablePlace, "name" | "address" | "locality">,
  host: string,
): string {
  return `nmap://search?query=${encodeURIComponent(buildNaverSearchQuery(place))}&appname=${encodeURIComponent(host)}`;
}

// 모바일 + 좌표가 있으면 네이버지도 앱 검색을 먼저 시도하고, 1.5초 뒤에도 문서가 보이면
// (앱이 열리지 않은 것) 웹 검색 링크를 연다. 그 외에는 웹 링크를 새 탭으로 연다.
export function openNaverMap(place: LinkablePlace, env: NaverMapOpenEnv): void {
  if (
    isMobileUserAgent(env.userAgent) &&
    place.lat !== null &&
    place.lng !== null
  ) {
    env.navigate(buildNaverAppUrl(place, env.host));
    env.setTimer(() => {
      if (env.visibilityState() === "visible") {
        env.openTab(place.mapUrl);
      }
    }, NAVER_APP_FALLBACK_MS);
    return;
  }
  env.openTab(place.mapUrl);
}

export function browserNaverMapEnv(): NaverMapOpenEnv {
  return {
    userAgent: navigator.userAgent,
    host: window.location.host,
    navigate: (url) => window.location.assign(url),
    openTab: (url) => {
      const opened = window.open(url, "_blank");
      if (opened) {
        opened.opener = null;
      } else {
        window.location.assign(url);
      }
    },
    visibilityState: () => document.visibilityState,
    setTimer: (callback, milliseconds) => {
      window.setTimeout(callback, milliseconds);
    },
  };
}
