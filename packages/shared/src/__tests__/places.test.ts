import { describe, expect, it } from "vitest";
import { bookmarkPlaceSchema, buildPlaceMapLink } from "../index";

describe("buildPlaceMapLink", () => {
  it("links domestic places to a Naver Map search", () => {
    expect(
      buildPlaceMapLink({
        name: "호랑이식당 성수점",
        locality: "서울 성동구",
        countryCode: "KR",
      }),
    ).toEqual({
      provider: "naver",
      url: `https://map.naver.com/p/search/${encodeURIComponent("호랑이식당 성수점 서울 성동구")}`,
    });
  });

  it("treats an unknown country as domestic", () => {
    expect(
      buildPlaceMapLink({ name: "카페", locality: null, countryCode: null })
        .provider,
    ).toBe("naver");
  });

  it("links foreign places to a Google Maps search", () => {
    expect(
      buildPlaceMapLink({
        name: "% Arabica 嵐山",
        locality: "Kyoto",
        countryCode: "JP",
      }),
    ).toEqual({
      provider: "google",
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("% Arabica 嵐山 Kyoto")}`,
    });
  });

  it("uses only the name when the locality is missing or blank", () => {
    expect(
      buildPlaceMapLink({ name: "이키야", locality: null, countryCode: "KR" })
        .url,
    ).toBe(`https://map.naver.com/p/search/${encodeURIComponent("이키야")}`);
    expect(
      buildPlaceMapLink({ name: "이키야", locality: "  ", countryCode: "KR" })
        .url,
    ).toBe(`https://map.naver.com/p/search/${encodeURIComponent("이키야")}`);
  });
});

describe("bookmarkPlaceSchema", () => {
  const place = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    name: "이키야",
    locality: "대전",
    countryCode: "KR",
    lat: 36.35,
    lng: 127.38,
    address: "대전 중구",
    mapProvider: "naver",
    mapUrl: "https://map.naver.com/p/search/%EC%9D%B4%ED%82%A4%EC%95%BC",
  };

  it("accepts a resolved place and a place without coordinates", () => {
    expect(bookmarkPlaceSchema.parse(place)).toEqual(place);
    expect(
      bookmarkPlaceSchema.parse({ ...place, lat: null, lng: null }).lat,
    ).toBeNull();
  });

  it("rejects an unknown provider and an invalid url", () => {
    expect(
      bookmarkPlaceSchema.safeParse({ ...place, mapProvider: "kakao" }).success,
    ).toBe(false);
    expect(
      bookmarkPlaceSchema.safeParse({ ...place, mapUrl: "not a url" }).success,
    ).toBe(false);
  });
});
