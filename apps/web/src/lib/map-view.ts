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
  hiddenIds: ReadonlySet<string>;
}

// 선택된 게시물은 숨김이어도 보인다(선택하면 자동으로 다시 표시되므로).
function isHidden(input: MapViewInput, groupId: string): boolean {
  return input.hiddenIds.has(groupId) && input.selectedId !== groupId;
}

export function computeMapMarkers(input: MapViewInput): MapMarkerView[] {
  const { results, colorIndex, selectedId, hoveredGroupId, hoveredPlaceId } =
    input;
  const visible = results.filter(
    ({ group }) => !isHidden(input, group.bookmark.id),
  );
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
  input: Pick<MapViewInput, "results" | "selectedId" | "hiddenIds">,
): MapPoint[] {
  const { results, selectedId, hiddenIds } = input;
  const targets = selectedId
    ? results.filter(({ group }) => group.bookmark.id === selectedId)
    : results.filter(({ group }) => !hiddenIds.has(group.bookmark.id));
  return targets.flatMap(({ places }) =>
    places.flatMap((place) =>
      place.lat !== null && place.lng !== null
        ? [{ lat: place.lat, lng: place.lng }]
        : [],
    ),
  );
}
