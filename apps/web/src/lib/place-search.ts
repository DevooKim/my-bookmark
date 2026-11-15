import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";

export interface PlaceSearchResult {
  group: PlaceGroup;
  // 검색 결과로 남은 장소(원래 순서). 검색어가 없으면 전부.
  places: BookmarkPlace[];
  // 게시글 제목만으로 모든 검색어가 일치해 장소 전부를 남긴 경우
  titleMatched: boolean;
}

// 대소문자·공백을 무시한 부분 일치를 위해 공백을 모두 지운 소문자로 바꾼다.
function compact(value: string): string {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

export function parseSearchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map(compact)
    .filter((term) => term.length > 0);
}

function includesAll(text: string, terms: string[]): boolean {
  return terms.every((term) => text.includes(term));
}

function placeText(place: BookmarkPlace): string {
  return compact(
    [place.name, place.locality, place.address].filter(Boolean).join(" "),
  );
}

// 게시글 제목만으로 모든 단어가 일치하면 그 게시물의 장소 전부를 남긴다. 아니면
// 장소(이름·지역·주소 + 소속 게시글 제목)마다 판정해 일치한 장소만 남기고,
// 남은 장소가 없는 게시물은 뺀다. 여러 단어는 모두 일치해야 한다(AND).
export function filterPlaceGroups(
  groups: readonly PlaceGroup[],
  query: string,
): PlaceSearchResult[] {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) {
    return groups.map((group) => ({
      group,
      places: group.places,
      titleMatched: false,
    }));
  }

  const results: PlaceSearchResult[] = [];
  for (const group of groups) {
    const title = compact(group.bookmark.title);
    if (includesAll(title, terms)) {
      results.push({ group, places: group.places, titleMatched: true });
      continue;
    }
    const places = group.places.filter((place) =>
      includesAll(`${placeText(place)}${title}`, terms),
    );
    if (places.length > 0) {
      results.push({ group, places, titleMatched: false });
    }
  }
  return results;
}
