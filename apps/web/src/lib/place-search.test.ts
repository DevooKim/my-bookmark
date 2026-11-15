import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";
import { describe, expect, it } from "vitest";
import { filterPlaceGroups, parseSearchTerms } from "./place-search";

let sequence = 0;

function place(
  name: string,
  locality: string | null,
  address: string | null = null,
): BookmarkPlace {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    name,
    locality,
    countryCode: "KR",
    lat: 37.5,
    lng: 127,
    address,
    mapProvider: "naver",
    mapUrl: "https://map.naver.com/p/search/x",
  };
}

function group(id: string, title: string, places: BookmarkPlace[]): PlaceGroup {
  return {
    bookmark: {
      id: `00000000-0000-4000-8000-0000000001${id}`,
      kind: "link",
      title,
      url: `https://example.com/${id}`,
      thumbnailUrl: null,
    },
    places,
  };
}

const cafes = group("01", "서촌 카페 6곳 추천", [
  place("대오서점", "서촌", "서울 종로구 통의동"),
  place("어니언", "안국", "서울 종로구 계동"),
]);
const ramen = group("02", "교토 말고 대전 라멘", [
  place("이키야", "대전", "대전 중구 은행동"),
]);
const seochon = group("03", "주말 산책 코스", [
  place("통인시장", "서촌", "서울 종로구 통인동"),
  place("한강 공원", "여의도"),
]);
const all = [cafes, ramen, seochon];

describe("filterPlaceGroups", () => {
  it("returns every group with all places for an empty query", () => {
    expect(filterPlaceGroups(all, "   ")).toEqual(
      all.map((item) => ({
        group: item,
        places: item.places,
        titleMatched: false,
      })),
    );
  });

  it("matches the post title and keeps every place of that post", () => {
    const results = filterPlaceGroups(all, "라멘");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ group: ramen, titleMatched: true });
    expect(results[0]?.places).toEqual(ramen.places);
  });

  it("matches a place name and keeps only the matching places", () => {
    const results = filterPlaceGroups(all, "어니언");
    expect(results).toHaveLength(1);
    expect(results[0]?.group).toBe(cafes);
    expect(results[0]?.places.map((item) => item.name)).toEqual(["어니언"]);
    expect(results[0]?.titleMatched).toBe(false);
  });

  it("matches the locality and the address", () => {
    expect(
      filterPlaceGroups(all, "안국")[0]?.places.map((item) => item.name),
    ).toEqual(["어니언"]);
    expect(
      filterPlaceGroups(all, "은행동")[0]?.places.map((item) => item.name),
    ).toEqual(["이키야"]);
  });

  it("requires every word to match across title, place name, and locality", () => {
    // 지역이 서촌인 장소를 가진 "카페 6곳" 게시물을 찾는다
    const results = filterPlaceGroups(all, "서촌 카페");
    expect(results.map((item) => item.group)).toEqual([cafes]);
    expect(results[0]?.titleMatched).toBe(true);

    // 제목에는 없고 장소의 지역과 이름이 각각 걸리는 경우
    const byPlace = filterPlaceGroups(all, "서촌 통인");
    expect(byPlace).toHaveLength(1);
    expect(byPlace[0]?.group).toBe(seochon);
    expect(byPlace[0]?.places.map((item) => item.name)).toEqual(["통인시장"]);

    // 한 단어라도 어디에도 없으면 제외
    expect(filterPlaceGroups(all, "서촌 라멘")).toEqual([]);
  });

  it("ignores case and whitespace inside the text", () => {
    const mixed = group("04", "Kyoto Guide", [
      place("% Arabica", "Higashiyama"),
    ]);
    expect(filterPlaceGroups([mixed], "KYOTOguide")).toHaveLength(1);
    expect(filterPlaceGroups([mixed], "arabica higashi")).toHaveLength(1);
    expect(filterPlaceGroups([mixed], "대전 한강")).toHaveLength(0);
  });

  it("returns nothing when no word matches anywhere", () => {
    expect(filterPlaceGroups(all, "존재하지않는검색어")).toEqual([]);
  });
});

describe("parseSearchTerms", () => {
  it("splits on whitespace and drops empties", () => {
    expect(parseSearchTerms("  서촌   Cafe ")).toEqual(["서촌", "cafe"]);
    expect(parseSearchTerms("")).toEqual([]);
  });
});
