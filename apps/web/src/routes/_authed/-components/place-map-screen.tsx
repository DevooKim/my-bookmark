import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";
import {
  ChevronUp,
  Eye,
  EyeOff,
  MapPin,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupColor,
  type MapAdapter,
  type MapAdapterFactory,
  type MapMarkerView,
  type MapZoomState,
} from "../../../lib/map-adapter";
import {
  resolveSheetDrag,
  type SheetState,
  sheetSummary,
} from "../../../lib/map-sheet";
import { computeFitPoints, computeMapMarkers } from "../../../lib/map-view";
import {
  loadHiddenIds,
  loadHiddenPlaceIds,
  loadOnlySelected,
  saveHiddenIds,
  saveHiddenPlaceIds,
  saveOnlySelected,
} from "../../../lib/map-visibility";
import { filterPlaceGroups } from "../../../lib/place-search";
import { MOBILE_MAP_QUERY, useMediaQuery } from "../../../lib/use-media-query";

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
  // 지도에서 숨긴 게시물. 저장소는 클라이언트에서만 읽을 수 있어 마운트 후 불러온다.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 개별로 숨긴 장소. 그룹 숨김과는 별도 상태·저장 키이고, 그룹 숨김이 우선한다.
  const [hiddenPlaceIds, setHiddenPlaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // '선택한 게시물만 보기'. 기기별 편의 설정이라 마운트 후 localStorage에서 불러온다.
  const [onlySelected, setOnlySelected] = useState(false);
  const isMobile = useMediaQuery(MOBILE_MAP_QUERY);
  // 모바일 하단 시트. 선택·검색어가 이미 있으면 목록부터 펼쳐 연다.
  const [sheetState, setSheetState] = useState<SheetState>(
    initialBookmarkId || query.trim().length > 0 ? "expanded" : "collapsed",
  );
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [zoomState, setZoomState] = useState<MapZoomState>({
    canZoomIn: true,
    canZoomOut: true,
  });
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

  useEffect(() => {
    setHiddenIds(loadHiddenIds());
    setHiddenPlaceIds(loadHiddenPlaceIds());
    setOnlySelected(loadOnlySelected());
  }, []);

  const toggleOnlySelected = useCallback(() => {
    setOnlySelected((current) => {
      saveOnlySelected(!current);
      return !current;
    });
  }, []);

  const updateHiddenIds = useCallback(
    (update: (next: Set<string>) => void) => {
      const next = new Set(hiddenIds);
      update(next);
      setHiddenIds(next);
      saveHiddenIds(next);
    },
    [hiddenIds],
  );

  const updateHiddenPlaceIds = useCallback(
    (update: (next: Set<string>) => void) => {
      const next = new Set(hiddenPlaceIds);
      update(next);
      setHiddenPlaceIds(next);
      saveHiddenPlaceIds(next);
    },
    [hiddenPlaceIds],
  );

  // 선택이 바뀌면 이전 화면의 호버 상태는 의미가 없다(행이 언마운트되어 leave가 오지 않는다).
  // 모바일에서는 게시물을 선택하면 시트를 펼쳐 장소 목록을 보여 준다.
  const selectGroup = useCallback((id: string | null) => {
    setSelectedId(id);
    setHoveredGroupId(null);
    setHoveredPlaceId(null);
    if (id !== null) {
      setSheetState("expanded");
    }
  }, []);

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
      selectGroup(null);
    }
  }, [selectedId, isLoading, selected, selectGroup]);

  // 숨긴 게시물을 선택하면 자동으로 다시 표시한다(마커 계산은 이미 선택을 우선한다).
  useEffect(() => {
    if (selectedId && hiddenIds.has(selectedId)) {
      updateHiddenIds((next) => next.delete(selectedId));
    }
  }, [selectedId, hiddenIds, updateHiddenIds]);

  const handlersRef = useRef({
    selectGroupOfPlace: (_placeId: string) => {},
    clearSelection: () => {},
    collapseSheet: () => {},
    failAuth: () => {},
  });
  handlersRef.current = {
    selectGroupOfPlace: (placeId) => {
      const owner = groups.find((group) =>
        group.places.some((place) => place.id === placeId),
      );
      if (owner) {
        selectGroup(owner.bookmark.id);
      }
    },
    // 모바일에서 지도를 탭하면 선택은 두고 시트만 접는다(접힌 시트가 선택된 제목을 보여 준다).
    // 데스크톱에서는 지금처럼 선택을 해제한다.
    clearSelection: () =>
      isMobile ? setSheetState("collapsed") : selectGroup(null),
    collapseSheet: () => {
      if (isMobile) {
        setSheetState("collapsed");
      }
    },
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
      onMapDragStart: () => handlersRef.current.collapseSheet(),
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

  useEffect(() => adapter?.subscribeZoom(setZoomState), [adapter]);

  // 모바일에서는 하단 시트가 아래쪽을 덮으므로 로고·저작권을 위쪽 모서리에 둔다.
  useEffect(() => {
    adapter?.setControlsAtTop(isMobile);
  }, [adapter, isMobile]);

  // 지도 컨테이너 크기가 바뀌면(회전, 주소창 변화) SDK에 알려 타일이 비지 않게 한다.
  useEffect(() => {
    const container = containerRef.current;
    if (!adapter || !container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => adapter.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [adapter]);

  // 모바일에서는 지도가 화면을 채우므로 뒤쪽 페이지가 같이 스크롤되지 않게 잠근다.
  useEffect(() => {
    if (!isMobile) {
      return;
    }
    document.documentElement.classList.add("map-screen-lock");
    return () => document.documentElement.classList.remove("map-screen-lock");
  }, [isMobile]);

  const markers = useMemo<MapMarkerView[]>(
    () =>
      computeMapMarkers({
        results,
        colorIndex,
        selectedId,
        hoveredGroupId,
        hoveredPlaceId,
        hiddenIds,
        hiddenPlaceIds,
        onlySelected,
      }),
    [
      results,
      colorIndex,
      selectedId,
      hoveredGroupId,
      hoveredPlaceId,
      hiddenIds,
      hiddenPlaceIds,
      onlySelected,
    ],
  );

  useEffect(() => {
    adapter?.setMarkers(markers);
  }, [adapter, markers]);

  // 선택이 있으면 그 그룹, 없으면 숨기지 않은 현재 결과 전체가 보이도록 맞춘다.
  // 호버는 좌표 계산에 들어가지 않으므로 지도가 움직이지 않는다.
  const fitPoints = useMemo(
    () => computeFitPoints({ results, selectedId, hiddenIds, hiddenPlaceIds }),
    [results, selectedId, hiddenIds, hiddenPlaceIds],
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
  const hiddenInResults = results
    .map(({ group }) => group.bookmark.id)
    .filter((id) => hiddenIds.has(id));
  // 검색 결과 그룹에 속한 개별 숨김 장소(그룹 숨김과 따로 센다).
  const hiddenPlacesInResults = results
    .flatMap(({ group }) => group.places)
    .filter((place) => hiddenPlaceIds.has(place.id))
    .map((place) => place.id);
  const hiddenCount = hiddenInResults.length + hiddenPlacesInResults.length;

  const expanded = !isMobile || sheetState === "expanded";
  const sheetSummaryText = sheetSummary({
    selectedTitle: selected?.group.bookmark.title ?? null,
    groupCount: results.length,
  });
  const clearInput = () => {
    setInput("");
    setSheetState("expanded");
  };

  return (
    // 모바일: 지도가 화면을 채우고(하단 탭 바 위까지) 목록은 그 위에 겹치는 하단 시트다.
    // 데스크톱(sm 이상): 기존처럼 좌측 패널 + 지도.
    <div className="fixed inset-x-0 top-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-10 overflow-hidden sm:static sm:z-auto sm:flex sm:h-[calc(100dvh-8.5rem)] sm:flex-row sm:gap-3 sm:overflow-visible">
      <section
        aria-label="지도"
        className="absolute inset-0 overflow-hidden bg-zinc-100 sm:relative sm:inset-auto sm:order-2 sm:flex-1 sm:rounded-2xl sm:border sm:border-zinc-200 dark:bg-zinc-900 sm:dark:border-zinc-800"
      >
        {createAdapter ? (
          // 네이버 SDK가 컨테이너의 인라인 style을 position: relative로 덮어쓰므로,
          // 부모를 채우는 일은 바깥 absolute 래퍼가 맡고 컨테이너는 크기만 채운다.
          // 지도는 모바일에서도 화면 아래까지 찬다. 네이버 로고·저작권은 시트가 덮지 않도록
          // 위쪽 모서리로 옮기므로(setControlsAtTop) 노치 아래에서 시작하게 한다.
          <div className="absolute inset-0 max-sm:top-[env(safe-area-inset-top)]">
            <div className="h-full w-full" ref={containerRef} />
          </div>
        ) : null}
        {isMobile ? (
          // 지도 위에 떠 있는 둥근 검색 바. 줌 버튼(우측, 검색 바 아래)·하단 로고/저작권과 겹치지 않는다.
          <div className="map-search-bar glass-surface">
            <Search
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-zinc-400"
            />
            <input
              aria-label="지도 검색"
              className="map-search-input w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
              onChange={(event) => {
                setInput(event.target.value);
                setSheetState("expanded");
              }}
              placeholder="게시글, 장소, 지역 검색"
              type="search"
              value={input}
            />
            {input.length > 0 ? (
              <button
                aria-label="검색어 지우기"
                className="icon-button -mr-2 shrink-0"
                onClick={clearInput}
                type="button"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
        {adapter && !mapError ? (
          // 우하단 네이버 로고·저작권과 겹치지 않도록 위로 띄운다(모바일은 검색 바 아래 우측).
          <div className="map-zoom-group glass-surface">
            <button
              aria-label="확대"
              className="map-zoom-button"
              disabled={!zoomState.canZoomIn}
              onClick={() => adapter.zoomIn()}
              type="button"
            >
              <Plus aria-hidden="true" className="h-5 w-5" />
            </button>
            <button
              aria-label="축소"
              className="map-zoom-button"
              disabled={!zoomState.canZoomOut}
              onClick={() => adapter.zoomOut()}
              type="button"
            >
              <Minus aria-hidden="true" className="h-5 w-5" />
            </button>
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
        className={`map-sheet flex min-h-0 flex-col sm:order-1 sm:w-80 sm:shrink-0 sm:overflow-y-auto ${
          isMobile ? "glass-surface" : "surface"
        }`}
        data-state={isMobile ? sheetState : "static"}
      >
        {isMobile ? (
          <SheetHandle
            expanded={sheetState === "expanded"}
            onChange={setSheetState}
            summary={sheetSummaryText}
          />
        ) : null}
        <div
          className="map-sheet-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 sm:overflow-visible sm:p-0"
          id="map-sheet-body"
          inert={!expanded}
        >
          {isMobile ? null : (
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
          )}

          {isLoading ? (
            <p className="text-sm text-zinc-500" role="status">
              장소를 불러오는 중…
            </p>
          ) : hasError ? (
            <p className="text-sm text-red-600" role="alert">
              장소를 불러오지 못했어요.
            </p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-zinc-500">
              지도에 표시할 장소가 없습니다
            </p>
          ) : results.length === 0 ? (
            <p className="text-sm text-zinc-500">검색 결과가 없습니다</p>
          ) : selected ? (
            <SelectedGroup
              color={groupColor(
                colorIndex.get(selected.group.bookmark.id) ?? 0,
              )}
              onClose={() => selectGroup(null)}
              onOpenNaverMap={onOpenNaverMap}
              onlySelected={onlySelected}
              onToggleOnlySelected={toggleOnlySelected}
              onPlaceHover={setHoveredPlaceId}
              hiddenPlaceIds={hiddenPlaceIds}
              onTogglePlaceHidden={(placeId) =>
                updateHiddenPlaceIds((next) => {
                  if (!next.delete(placeId)) {
                    next.add(placeId);
                  }
                })
              }
              onPlaceFocus={(place) => {
                // 모바일에서는 장소 행을 누르면 시트를 접어 그 마커가 보이게 한다.
                if (isMobile) {
                  setSheetState("collapsed");
                }
                if (place.lat !== null && place.lng !== null) {
                  adapter?.panTo({ lat: place.lat, lng: place.lng });
                }
              }}
              result={selected}
            />
          ) : (
            <>
              {hiddenCount > 0 ? (
                <button
                  className="btn-secondary self-start px-3 text-xs"
                  onClick={() => {
                    if (hiddenInResults.length > 0) {
                      updateHiddenIds((next) => {
                        for (const id of hiddenInResults) {
                          next.delete(id);
                        }
                      });
                    }
                    if (hiddenPlacesInResults.length > 0) {
                      updateHiddenPlaceIds((next) => {
                        for (const id of hiddenPlacesInResults) {
                          next.delete(id);
                        }
                      });
                    }
                  }}
                  type="button"
                >
                  숨긴 {hiddenCount}개 모두 표시
                </button>
              ) : null}
              <ul aria-label="게시물 그룹" className="flex flex-col gap-1">
                {results.map(({ group, places, titleMatched }) => {
                  const id = group.bookmark.id;
                  const isGroupHidden = hiddenIds.has(id);
                  const hiddenPlaceCount = group.places.filter((place) =>
                    hiddenPlaceIds.has(place.id),
                  ).length;
                  return (
                    <li
                      className="flex items-start gap-1 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      key={id}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(event.relatedTarget)
                        ) {
                          setHoveredGroupId(null);
                        }
                      }}
                      onFocus={() => setHoveredGroupId(id)}
                      onPointerEnter={(event) => {
                        if (event.pointerType !== "touch") {
                          setHoveredGroupId(id);
                        }
                      }}
                      onPointerLeave={() => setHoveredGroupId(null)}
                    >
                      <button
                        className={`flex min-w-0 flex-1 items-start gap-2 rounded-xl px-2 py-2 text-left ${
                          isGroupHidden ? "opacity-50" : ""
                        }`}
                        onClick={() => selectGroup(id)}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-1 h-3 w-3 shrink-0 rounded-full"
                          style={{
                            background: groupColor(colorIndex.get(id) ?? 0),
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {group.bookmark.title}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            장소 {group.places.length}곳
                            {hiddenPlaceCount > 0
                              ? ` (${hiddenPlaceCount}곳 숨김)`
                              : ""}
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
                      <button
                        aria-label={
                          isGroupHidden ? "지도에 표시" : "지도에서 숨기기"
                        }
                        aria-pressed={isGroupHidden}
                        className="icon-button mt-1 shrink-0"
                        onClick={() =>
                          updateHiddenIds((next) => {
                            if (!next.delete(id)) {
                              next.add(id);
                            }
                          })
                        }
                        type="button"
                      >
                        {isGroupHidden ? (
                          <EyeOff aria-hidden="true" className="h-4 w-4" />
                        ) : (
                          <Eye aria-hidden="true" className="h-4 w-4" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// 모바일 하단 시트의 손잡이 + 한 줄 요약. 탭하면 접힘/펼침이 바뀌고, 위아래로 끌어도 바뀐다.
function SheetHandle({
  expanded,
  summary,
  onChange,
}: {
  expanded: boolean;
  summary: string;
  onChange(next: SheetState): void;
}) {
  const startY = useRef<number | null>(null);
  const current: SheetState = expanded ? "expanded" : "collapsed";
  return (
    <button
      aria-controls="map-sheet-body"
      aria-expanded={expanded}
      aria-label={`${summary} — 목록 ${expanded ? "접기" : "펼치기"}`}
      className="map-sheet-handle"
      onClick={(event) => {
        // 포인터 드래그가 상태를 이미 정했으면 click은 무시한다. 키보드 click(detail 0)은 토글한다.
        if (event.detail === 0) {
          onChange(expanded ? "collapsed" : "expanded");
        }
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
      onPointerDown={(event) => {
        startY.current = event.clientY;
        // 손잡이 밖으로 손가락이 나가도 pointerup을 받는다(jsdom에는 없다).
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (startY.current !== null) {
          onChange(resolveSheetDrag(current, event.clientY - startY.current));
        }
        startY.current = null;
      }}
      type="button"
    >
      <span aria-hidden="true" className="map-sheet-grabber" />
      <span aria-hidden="true" className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
          {summary}
        </span>
        <ChevronUp
          className={`h-4 w-4 shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </span>
    </button>
  );
}

function SelectedGroup({
  result,
  color,
  onClose,
  onPlaceFocus,
  onPlaceHover,
  hiddenPlaceIds,
  onTogglePlaceHidden,
  onOpenNaverMap,
  onlySelected,
  onToggleOnlySelected,
}: {
  result: { group: PlaceGroup; places: BookmarkPlace[] };
  color: string;
  onClose(): void;
  onPlaceFocus(place: BookmarkPlace): void;
  onPlaceHover(placeId: string | null): void;
  hiddenPlaceIds: ReadonlySet<string>;
  onTogglePlaceHidden(placeId: string): void;
  onOpenNaverMap(place: BookmarkPlace): void;
  onlySelected: boolean;
  onToggleOnlySelected(): void;
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
      <button
        aria-checked={onlySelected}
        className="map-only-toggle"
        onClick={onToggleOnlySelected}
        role="switch"
        type="button"
      >
        <span>선택한 게시물만 보기</span>
        <span aria-hidden="true" className="map-switch" data-on={onlySelected}>
          <span className="map-switch-knob" />
        </span>
      </button>
      <ul aria-label="장소" className="flex flex-col gap-1">
        {places.map((place) => {
          const placeHidden = hiddenPlaceIds.has(place.id);
          return (
            <li
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              key={place.id}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  onPlaceHover(null);
                }
              }}
              onFocus={() => onPlaceHover(place.id)}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") {
                  onPlaceHover(place.id);
                }
              }}
              onPointerLeave={() => onPlaceHover(null)}
            >
              <button
                className={`flex min-w-0 flex-1 items-start gap-2 text-left ${
                  placeHidden ? "opacity-50" : ""
                }`}
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
                aria-label={
                  placeHidden
                    ? "이 장소 지도에 표시"
                    : "이 장소 지도에서 숨기기"
                }
                aria-pressed={placeHidden}
                className="icon-button shrink-0"
                onClick={() => onTogglePlaceHidden(place.id)}
                type="button"
              >
                {placeHidden ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
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
          );
        })}
      </ul>
    </div>
  );
}
