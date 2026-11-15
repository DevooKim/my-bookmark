import { describe, expect, it, vi } from "vitest";
import {
  buildNaverAppUrl,
  isMobileUserAgent,
  NAVER_APP_FALLBACK_MS,
  type NaverMapOpenEnv,
  openNaverMap,
} from "./naver-map-link";

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const desktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0";

const place = {
  name: "호랑이식당 성수점",
  lat: 37.5446 as number | null,
  lng: 127.0557 as number | null,
  mapUrl: "https://map.naver.com/p/search/web",
};

function createEnv(overrides: Partial<NaverMapOpenEnv> = {}) {
  const timers: (() => void)[] = [];
  const env = {
    userAgent: iphone,
    host: "bm.example.com",
    navigate: vi.fn(),
    openTab: vi.fn(),
    visibilityState: vi.fn<() => DocumentVisibilityState>(() => "visible"),
    setTimer: vi.fn((callback: () => void) => {
      timers.push(callback);
    }),
    ...overrides,
  } satisfies NaverMapOpenEnv;
  return {
    env,
    runTimers: () => {
      for (const callback of timers) {
        callback();
      }
    },
  };
}

describe("naver map link", () => {
  it("detects iOS and Android user agents only", () => {
    expect(isMobileUserAgent(iphone)).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 15)")).toBe(true);
    expect(isMobileUserAgent(desktop)).toBe(false);
  });

  it("builds the nmap place URL", () => {
    expect(
      buildNaverAppUrl(
        { name: "호랑이식당 성수점", lat: 37.5446, lng: 127.0557 },
        "bm.example.com",
      ),
    ).toBe(
      `nmap://place?lat=37.5446&lng=127.0557&name=${encodeURIComponent("호랑이식당 성수점")}&appname=bm.example.com`,
    );
  });

  it("tries the app first on mobile and falls back to the web link while still visible", () => {
    const { env, runTimers } = createEnv();
    openNaverMap(place, env);

    expect(env.navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^nmap:\/\/place\?lat=37\.5446&lng=127\.0557/),
    );
    expect(env.openTab).not.toHaveBeenCalled();
    expect(env.setTimer).toHaveBeenCalledWith(
      expect.any(Function),
      NAVER_APP_FALLBACK_MS,
    );

    runTimers();
    expect(env.openTab).toHaveBeenCalledWith(place.mapUrl);
  });

  it("does not open the web link when the app took over the page", () => {
    const { env, runTimers } = createEnv({
      visibilityState: vi.fn<() => DocumentVisibilityState>(() => "hidden"),
    });
    openNaverMap(place, env);
    runTimers();
    expect(env.openTab).not.toHaveBeenCalled();
  });

  it("opens the web link in a new tab on desktop", () => {
    const { env } = createEnv({ userAgent: desktop });
    openNaverMap(place, env);
    expect(env.openTab).toHaveBeenCalledWith(place.mapUrl);
    expect(env.navigate).not.toHaveBeenCalled();
    expect(env.setTimer).not.toHaveBeenCalled();
  });

  it("opens the web link on mobile when there are no coordinates", () => {
    const { env } = createEnv();
    openNaverMap({ ...place, lat: null, lng: null }, env);
    expect(env.openTab).toHaveBeenCalledWith(place.mapUrl);
    expect(env.navigate).not.toHaveBeenCalled();
  });
});
