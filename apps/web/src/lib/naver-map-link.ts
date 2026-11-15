import type { BookmarkPlace } from "@my-bookmark/shared";

export const NAVER_APP_FALLBACK_MS = 1500;

type LinkablePlace = Pick<BookmarkPlace, "name" | "lat" | "lng" | "mapUrl">;

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

export function buildNaverAppUrl(
  place: { name: string; lat: number; lng: number },
  host: string,
): string {
  return `nmap://place?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}&appname=${encodeURIComponent(host)}`;
}

// 모바일 + 좌표가 있으면 네이버지도 앱을 먼저 시도하고, 1.5초 뒤에도 문서가 보이면
// (앱이 열리지 않은 것) 웹 검색 링크를 연다. 그 외에는 웹 링크를 새 탭으로 연다.
export function openNaverMap(place: LinkablePlace, env: NaverMapOpenEnv): void {
  if (
    isMobileUserAgent(env.userAgent) &&
    place.lat !== null &&
    place.lng !== null
  ) {
    env.navigate(
      buildNaverAppUrl(
        { name: place.name, lat: place.lat, lng: place.lng },
        env.host,
      ),
    );
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
