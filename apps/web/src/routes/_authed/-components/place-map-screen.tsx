import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";
import { MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  groupColor,
  type MapAdapter,
  type MapAdapterFactory,
  type MapMarkerView,
} from "../../../lib/map-adapter";
import { filterPlaceGroups } from "../../../lib/place-search";

const SEARCH_DEBOUNCE_MS = 200;

export interface PlaceMapScreenProps {
  groups: PlaceGroup[];
  isLoading: boolean;
  hasError: boolean;
  // URL의 q 검색 파라미터(적용된 검색어)
  query: string;
  onQueryChange(query: string): void;
  initialBookmarkId?: string | undefined;
  // null이면 지도 대신 안내 문구를 보여 준다(키 미설정).
  createAdapter: MapAdapterFactory | null;
  onOpenNaverMap(place: BookmarkPlace): void;
}

export function PlaceMapScreen({
  groups,
  isLoading,
  hasError,
  query,
  onQueryChange,
  initialBookmarkId,
  createAdapter,
  onOpenNaverMap,
}: PlaceMapScreenProps) {
  const [input, setInput] = useState(query);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialBookmarkId ?? null,
  );
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 그룹 색은 검색 전후로 바뀌지 않도록 전체 목록 기준 순서로 고정한다.
  const colorIndex = useMemo(
    () => new Map(groups.map((group, index) => [group.bookmark.id, index])),
    [groups],
  );
  const results = useMemo(
    () => filterPlaceGroups(groups, query),
    [groups, query],
  );
  const selected =
    results.find((result) => result.group.bookmark.id === selectedId) ?? null;

  // 입력은 200ms 디바운스해 URL 검색 파라미터에 반영한다.
  useEffect(() => {
    if (input === query) {
      return;
    }
    const timer = window.setTimeout(
      () => onQueryChange(input),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [input, query, onQueryChange]);

  // 선택된 게시물이 결과에서 빠지면 선택을 해제한다(데이터 로딩 중에는 유지).
  useEffect(() => {
    if (selectedId && !isLoading && !selected) {
      setSelectedId(null);
    }
  }, [selectedId, isLoading, selected]);

  const handlersRef = useRef({
    selectGroupOfPlace: (_placeId: string) => {},
    clearSelection: () => {},
    failAuth: () => {},
  });
  handlersRef.current = {
    selectGroupOfPlace: (placeId) => {
      const owner = groups.find((group) =>
        group.places.some((place) => place.id === placeId),
      );
      if (owner) {
        setSelectedId(owner.bookmark.id);
      }
    },
    clearSelection: () => setSelectedId(null),
    failAuth: () =>
      setMapError(
        "네이버 지도 인증에 실패했어요. 인증 키와 서비스 URL 등록을 확인해 주세요.",
      ),
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!createAdapter || !container) {
      return;
    }
    let cancelled = false;
    let created: MapAdapter | null = null;
    createAdapter(container, {
      onMarkerClick: (markerId) =>
        handlersRef.current.selectGroupOfPlace(markerId),
      onBackgroundClick: () => handlersRef.current.clearSelection(),
      onAuthFailure: () => handlersRef.current.failAuth(),
    })
      .then((next) => {
        if (cancelled) {
          next.destroy();
          return;
        }
        created = next;
        setAdapter(next);
      })
      .catch(() => {
        if (!cancelled) {
          setMapError("지도를 불러오지 못했어요.");
        }
      });
    return () => {
      cancelled = true;
      created?.destroy();
      setAdapter(null);
    };
  }, [createAdapter]);

  const markers = useMemo<MapMarkerView[]>(
    () =>
      results.flatMap(({ group, places }) =>
        places.map((place) => ({
          id: place.id,
          groupId: group.bookmark.id,
          // API는 좌표가 있는 장소만 내려 주므로 null이면 건너뛴다.
          lat: place.lat ?? Number.NaN,
          lng: place.lng ?? Number.NaN,
          color: groupColor(colorIndex.get(group.bookmark.id) ?? 0),
          label: String(
            group.places.findIndex((candidate) => candidate.id === place.id) +
              1,
          ),
          state: !selectedId
            ? ("normal" as const)
            : selectedId === group.bookmark.id
              ? ("active" as const)
              : ("dim" as const),
        })),
      ),
    [results, colorIndex, selectedId],
  );

  useEffect(() => {
    adapter?.setMarkers(markers.filter((marker) => !Number.isNaN(marker.lat)));
  }, [adapter, markers]);

  // 선택이 있으면 그 그룹, 없으면 현재 결과 전체가 보이도록 맞춘다.
  const fitPoints = useMemo(
    () =>
      (selected ? [selected] : results).flatMap(({ places }) =>
        places.flatMap((place) =>
          place.lat !== null && place.lng !== null
            ? [{ lat: place.lat, lng: place.lng }]
            : [],
        ),
      ),
    [selected, results],
  );
  const fitKey = fitPoints
    .map((point) => `${point.lat},${point.lng}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey가 fitPoints의 값 동일성을 대표한다.
  useEffect(() => {
    if (adapter && fitPoints.length > 0) {
      adapter.fitTo(fitPoints);
    }
  }, [adapter, fitKey]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 sm:h-[calc(100dvh-8.5rem)] sm:flex-row">
      <section
        aria-label="지도"
        className="relative h-[45dvh] shrink-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 sm:order-2 sm:h-auto sm:flex-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {createAdapter ? (
          // 네이버 SDK가 컨테이너의 인라인 style을 position: relative로 덮어쓰므로,
          // 부모를 채우는 일은 바깥 absolute 래퍼가 맡고 컨테이너는 크기만 채운다.
          <div className="absolute inset-0">
            <div className="h-full w-full" ref={containerRef} />
          </div>
        ) : null}
        {!createAdapter || mapError ? (
          <p
            className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-100 px-6 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
            role="status"
          >
            {mapError ??
              "지도 인증 키(VITE_NAVER_MAP_CLIENT_ID)가 설정되지 않아 지도를 표시할 수 없어요. 장소 목록은 그대로 사용할 수 있어요."}
          </p>
        ) : null}
      </section>

      <aside
        aria-label="장소 목록"
        className="surface flex min-h-0 flex-col gap-3 rounded-t-3xl p-3 sm:order-1 sm:w-80 sm:shrink-0 sm:overflow-y-auto sm:rounded-2xl"
      >
        <label className="search-field">
          <Search
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-zinc-400"
          />
          <input
            aria-label="지도 검색"
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            onChange={(event) => setInput(event.target.value)}
            placeholder="게시글, 장소, 지역 검색"
            type="search"
            value={input}
          />
        </label>

        {isLoading ? (
          <p className="text-sm text-zinc-500" role="status">
            장소를 불러오는 중…
          </p>
        ) : hasError ? (
          <p className="text-sm text-red-600" role="alert">
            장소를 불러오지 못했어요.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-zinc-500">지도에 표시할 장소가 없습니다</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-zinc-500">검색 결과가 없습니다</p>
        ) : selected ? (
          <SelectedGroup
            color={groupColor(colorIndex.get(selected.group.bookmark.id) ?? 0)}
            onClose={() => setSelectedId(null)}
            onOpenNaverMap={onOpenNaverMap}
            onPlaceFocus={(place) => {
              if (place.lat !== null && place.lng !== null) {
                adapter?.panTo({ lat: place.lat, lng: place.lng });
              }
            }}
            result={selected}
          />
        ) : (
          <ul aria-label="게시물 그룹" className="flex flex-col gap-1">
            {results.map(({ group, places, titleMatched }) => (
              <li key={group.bookmark.id}>
                <button
                  className="flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => setSelectedId(group.bookmark.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{
                      background: groupColor(
                        colorIndex.get(group.bookmark.id) ?? 0,
                      ),
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {group.bookmark.title}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      장소 {group.places.length}곳
                    </span>
                    {searching && !titleMatched ? (
                      <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-300">
                        {places
                          .map((place) =>
                            [place.name, place.locality]
                              .filter(Boolean)
                              .join(" · "),
                          )
                          .join(", ")}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function SelectedGroup({
  result,
  color,
  onClose,
  onPlaceFocus,
  onOpenNaverMap,
}: {
  result: { group: PlaceGroup; places: BookmarkPlace[] };
  color: string;
  onClose(): void;
  onPlaceFocus(place: BookmarkPlace): void;
  onOpenNaverMap(place: BookmarkPlace): void;
}) {
  const { group, places } = result;
  const { bookmark } = group;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <a
          className="min-w-0 flex-1 text-sm font-semibold leading-snug hover:text-blue-600"
          href={
            bookmark.kind === "link" ? bookmark.url : `/images/${bookmark.id}`
          }
          {...(bookmark.kind === "link"
            ? { rel: "noreferrer", target: "_blank" }
            : {})}
        >
          {bookmark.title}
        </a>
        <button
          aria-label="선택 해제"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul aria-label="장소" className="flex flex-col gap-1">
        {places.map((place) => (
          <li
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            key={place.id}
          >
            <button
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              onClick={() => onPlaceFocus(place)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold text-white"
                style={{ background: color }}
              >
                {group.places.findIndex(
                  (candidate) => candidate.id === place.id,
                ) + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{place.name}</span>
                {place.locality || place.address ? (
                  <span className="block truncate text-xs text-zinc-500">
                    {[place.locality, place.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              aria-label={`${place.name} 네이버지도에서 열기`}
              className="btn-secondary shrink-0 gap-1 px-2 text-xs"
              onClick={() => onOpenNaverMap(place)}
              type="button"
            >
              <MapPin aria-hidden="true" className="h-3 w-3" /> 네이버지도
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
