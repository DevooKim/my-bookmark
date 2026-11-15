import { groupColor, type MapMarkerView, type MapPoint } from "./map-adapter";
import type { PlaceSearchResult } from "./place-search";

export interface MapViewInput {
  results: readonly PlaceSearchResult[];
  // 게시물 id → 전체 목록 기준 순번(색 고정용). 숨김·검색과 무관하다.
  colorIndex: ReadonlyMap<string, number>;
  selectedId: string | null;
  // 목록 행에 마우스/포커스가 올라간 게시물. 선택이 없을 때만 강조에 쓴다.
  hoveredGroupId: string | null;
  // 선택된 게시물의 장소 행에 올라간 장소.
  hoveredPlaceId: string | null;
  // 숨긴 게시물. 개별 장소 상태와 무관하게 그 그룹의 핀을 모두 숨긴다(그룹 숨김 우선).
  hiddenIds: ReadonlySet<string>;
  // 개별로 숨긴 장소. 그룹이 보이는 동안 그 핀만 뺀다.
  hiddenPlaceIds: ReadonlySet<string>;
  // 선택이 있을 때 선택 그룹 외 마커를 흐리게 두지 않고 지도에서 아예 뺀다.
  // 선택이 없으면 아무 영향이 없다.
  onlySelected?: boolean;
}

// 선택된 게시물은 숨김이어도 보인다(선택하면 자동으로 다시 표시되므로).
function isGroupHidden(
  input: Pick<MapViewInput, "hiddenIds" | "selectedId">,
  groupId: string,
): boolean {
  return input.hiddenIds.has(groupId) && input.selectedId !== groupId;
}

// 우선순위(높은 것부터): ① '선택한 게시물만 보기'가 켜져 있으면 선택 그룹 외 전부 숨김
// ② 그룹 숨김(선택된 그룹은 예외) ③ 개별 장소 숨김(선택 그룹 안에서도 적용).
// 호버 강조는 이 필터를 통과한 마커에만 적용된다.
function visiblePlaces(
  input: Pick<
    MapViewInput,
    "hiddenIds" | "hiddenPlaceIds" | "selectedId" | "onlySelected"
  >,
  result: PlaceSearchResult,
): PlaceSearchResult["places"] {
  if (
    input.onlySelected &&
    input.selectedId !== null &&
    input.selectedId !== result.group.bookmark.id
  ) {
    return [];
  }
  if (isGroupHidden(input, result.group.bookmark.id)) {
    return [];
  }
  return result.places.filter((place) => !input.hiddenPlaceIds.has(place.id));
}

export function computeMapMarkers(input: MapViewInput): MapMarkerView[] {
  const { results, colorIndex, selectedId, hoveredGroupId, hoveredPlaceId } =
    input;
  // 보이는 핀이 하나도 없는 그룹은 호버 강조 대상이 아니다.
  const visible = results.flatMap((result) => {
    const places = visiblePlaces(input, result);
    return places.length > 0 ? [{ group: result.group, places }] : [];
  });
  const highlightedId =
    selectedId ??
    (hoveredGroupId &&
    visible.some(({ group }) => group.bookmark.id === hoveredGroupId)
      ? hoveredGroupId
      : null);

  return visible.flatMap(({ group, places }) =>
    places.flatMap((place) => {
      // API는 좌표가 있는 장소만 내려 주므로 null이면 건너뛴다.
      if (place.lat === null || place.lng === null) {
        return [];
      }
      return [
        {
          id: place.id,
          groupId: group.bookmark.id,
          lat: place.lat,
          lng: place.lng,
          color: groupColor(colorIndex.get(group.bookmark.id) ?? 0),
          label: String(
            group.places.findIndex((candidate) => candidate.id === place.id) +
              1,
          ),
          state: !highlightedId
            ? ("normal" as const)
            : highlightedId === group.bookmark.id
              ? ("active" as const)
              : ("dim" as const),
          emphasized:
            selectedId === group.bookmark.id && hoveredPlaceId === place.id,
        },
      ];
    }),
  );
}

// 선택이 있으면 그 그룹, 없으면 숨기지 않은 결과 전체가 보이도록 맞출 좌표.
export function computeFitPoints(
  input: Pick<
    MapViewInput,
    "results" | "selectedId" | "hiddenIds" | "hiddenPlaceIds" | "onlySelected"
  >,
): MapPoint[] {
  const { results, selectedId } = input;
  const targets = (
    selectedId
      ? results.filter(({ group }) => group.bookmark.id === selectedId)
      : results
  ).map((result) => ({ places: visiblePlaces(input, result) }));
  return targets.flatMap(({ places }) =>
    places.flatMap((place) =>
      place.lat !== null && place.lng !== null
        ? [{ lat: place.lat, lng: place.lng }]
        : [],
    ),
  );
}
