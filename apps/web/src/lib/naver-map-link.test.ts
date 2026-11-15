import { describe, expect, it, vi } from "vitest";
import {
  buildNaverAppUrl,
  buildNaverSearchQuery,
  extractCityDistrict,
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
  locality: "성수동" as string | null,
  address: "서울특별시 성동구 아차산로 100" as string | null,
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

  it("builds the nmap search URL with the name and the district from the address", () => {
    expect(buildNaverAppUrl(place, "bm.example.com")).toBe(
      `nmap://search?query=${encodeURIComponent("호랑이식당 성수점 성동구")}&appname=bm.example.com`,
    );
    expect(buildNaverAppUrl(place, "bm.example.com")).not.toContain("place?");
  });

  describe("extractCityDistrict", () => {
    it.each([
      ["서울특별시 마포구 월드컵로 1", "마포구"],
      ["부산광역시 해운대구 해운대해변로 264", "해운대구"],
      ["경기도 평택시 평택로 1", "평택시"],
      ["경기도 수원시 영통구 광교로 1", "수원시 영통구"],
      ["인천광역시 강화군 강화읍 1", "강화군"],
      ["제주특별자치도 제주시 연동 1", "제주시"],
      ["서울 광진구 능동로 1", "광진구"],
      ["  서울특별시   종로구  ", "종로구"],
    ])("%s -> %s", (address, expected) => {
      expect(extractCityDistrict(address)).toBe(expected);
    });

    it("falls back to the city itself when there is no district (Sejong)", () => {
      expect(extractCityDistrict("세종특별자치시 한누리대로 2130")).toBe(
        "세종특별자치시",
      );
    });

    it("returns null for empty values and addresses without a city or district", () => {
      expect(extractCityDistrict(null)).toBeNull();
      expect(extractCityDistrict(undefined)).toBeNull();
      expect(extractCityDistrict("")).toBeNull();
      expect(extractCityDistrict("   ")).toBeNull();
      expect(extractCityDistrict("경기도 아차산로 100")).toBeNull();
    });

    it("only looks at the leading tokens, not street names further on", () => {
      expect(
        extractCityDistrict("강원특별자치도 평창군 대관령면 한국시 1"),
      ).toBe("평창군");
      expect(extractCityDistrict("경기도 아차산로 1 구리시 2 3")).toBeNull();
    });
  });

  describe("buildNaverSearchQuery", () => {
    it("uses name + district, then locality, then the name alone", () => {
      expect(buildNaverSearchQuery(place)).toBe("호랑이식당 성수점 성동구");
      expect(buildNaverSearchQuery({ ...place, address: null })).toBe(
        "호랑이식당 성수점 성수동",
      );
      expect(
        buildNaverSearchQuery({
          ...place,
          address: "도로명 없음",
          locality: "서촌",
        }),
      ).toBe("호랑이식당 성수점 서촌");
      expect(
        buildNaverSearchQuery({ ...place, address: null, locality: null }),
      ).toBe("호랑이식당 성수점");
      expect(
        buildNaverSearchQuery({ ...place, address: "", locality: "  " }),
      ).toBe("호랑이식당 성수점");
    });

    it("does not repeat a region that is already in the name", () => {
      expect(
        buildNaverSearchQuery({
          name: "마포구 곱창집",
          address: "서울특별시 마포구 월드컵로 1",
          locality: null,
        }),
      ).toBe("마포구 곱창집");
    });
  });

  it("tries the app first on mobile and falls back to the web link while still visible", () => {
    const { env, runTimers } = createEnv();
    openNaverMap(place, env);

    expect(env.navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^nmap:\/\/search\?query=/),
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
