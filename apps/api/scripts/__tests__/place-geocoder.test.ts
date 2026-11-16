import { describe, expect, it, vi } from "vitest";
import {
  createPlaceGeocoder,
  namesMatch,
  parseKoreanCoordinate,
  stripSearchMarkup,
} from "../admin/services/place-geocoder";

function item(overrides: Record<string, string> = {}) {
  return {
    title: "<b>호랑이식당</b> 성수점",
    link: "",
    category: "음식점>한식",
    description: "",
    telephone: "",
    address: "서울특별시 성동구 성수동2가 1-1",
    roadAddress: "서울특별시 성동구 아차산로 1",
    mapx: "1270284390",
    mapy: "374977110",
    ...overrides,
  };
}

function jsonResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({ lastBuildDate: "x", total: items.length, items }),
    { status: 200 },
  );
}

function createGeocoder(fetchImpl: typeof fetch) {
  return createPlaceGeocoder({
    clientId: "test-id",
    clientSecret: "test-secret",
    fetchImpl,
  });
}

describe("place geocoder", () => {
  it("calls NAVER API HUB local search with name and locality", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([item()]));
    await createGeocoder(fetchImpl).geocode({
      name: "호랑이식당 성수점",
      locality: "서울 성동구",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://naverapihub.apigw.ntruss.com/search/v1/local?query=${encodeURIComponent("호랑이식당 성수점 서울 성동구")}&display=5`,
    );
    expect(init.headers).toEqual({
      "X-NCP-APIGW-API-KEY-ID": "test-id",
      "X-NCP-APIGW-API-KEY": "test-secret",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("searches by name alone when there is no locality", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([item()]));
    await createGeocoder(fetchImpl).geocode({
      name: "호랑이식당",
      locality: null,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      `query=${encodeURIComponent("호랑이식당")}&display=5`,
    );
  });

  it("adopts the first matching item and converts the 1e7 coordinates", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([
          item({ title: "<b>다른</b>가게", mapx: "1260000000" }),
          item(),
        ]),
      );
    await expect(
      createGeocoder(fetchImpl).geocode({
        name: "호랑이식당",
        locality: "성수",
      }),
    ).resolves.toEqual({
      status: "resolved",
      lat: 37.497711,
      lng: 127.028439,
      address: "서울특별시 성동구 성수동2가 1-1",
      roadAddress: "서울특별시 성동구 아차산로 1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns not_found without a second name-only search when nothing matches", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([item({ title: "완전히 다른 가게" })]));
    await expect(
      createGeocoder(fetchImpl).geocode({
        name: "호랑이식당",
        locality: "성수",
      }),
    ).resolves.toEqual({ status: "not_found" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for an empty result list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    await expect(
      createGeocoder(fetchImpl).geocode({ name: "호랑이식당", locality: null }),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("does not adopt a match whose coordinates fall outside Korea", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([item({ mapx: "1394000000" })]));
    await expect(
      createGeocoder(fetchImpl).geocode({ name: "호랑이식당", locality: null }),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("maps empty addresses to null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([item({ address: "", roadAddress: "" })]),
      );
    await expect(
      createGeocoder(fetchImpl).geocode({ name: "호랑이식당", locality: null }),
    ).resolves.toMatchObject({ address: null, roadAddress: null });
  });

  it("throws on HTTP errors, network errors, and malformed responses", async () => {
    await expect(
      createGeocoder(
        vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
      ).geocode({ name: "호랑이식당", locality: null }),
    ).rejects.toThrow("status 429");
    await expect(
      createGeocoder(vi.fn().mockRejectedValue(new Error("offline"))).geocode({
        name: "호랑이식당",
        locality: null,
      }),
    ).rejects.toThrow("offline");
    await expect(
      createGeocoder(
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))),
      ).geocode({ name: "호랑이식당", locality: null }),
    ).rejects.toThrow();
  });
});

describe("place name matching", () => {
  it("strips markup and entities from titles", () => {
    expect(stripSearchMarkup("<b>이키야</b> &amp; 카페")).toBe("이키야 & 카페");
  });

  it("matches ignoring spaces, symbols, and case in either direction", () => {
    expect(namesMatch("호랑이 식당", "<b>호랑이식당</b>")).toBe(true);
    expect(namesMatch("호랑이식당 성수점", "호랑이식당")).toBe(true);
    expect(namesMatch("호랑이식당", "호랑이식당 성수점")).toBe(true);
    expect(namesMatch("% Arabica", "% ARABICA 성수")).toBe(true);
    expect(namesMatch("호랑이식당", "사자식당")).toBe(false);
    expect(namesMatch("---", "호랑이식당")).toBe(false);
  });
});

describe("coordinate parsing", () => {
  it("converts 1e7 integers and passes plain degrees through", () => {
    expect(parseKoreanCoordinate("1270284390", "374977110")).toEqual({
      lng: 127.028439,
      lat: 37.497711,
    });
    expect(parseKoreanCoordinate("127.03", "37.5")).toEqual({
      lng: 127.03,
      lat: 37.5,
    });
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(parseKoreanCoordinate("1394000000", "354000000")).toBeNull();
    expect(parseKoreanCoordinate("1270000000", "100000000")).toBeNull();
    expect(parseKoreanCoordinate("abc", "374977110")).toBeNull();
  });
});
