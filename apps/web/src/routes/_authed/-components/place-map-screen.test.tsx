// @vitest-environment jsdom

import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROUP_COLORS,
  type MapAdapter,
  type MapAdapterFactory,
  type MapAdapterHandlers,
  type MapMarkerView,
  type MapPoint,
  type MapZoomState,
} from "../../../lib/map-adapter";
import { PlaceMapScreen, type PlaceMapScreenProps } from "./place-map-screen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function place(id: string, name: string, locality: string, lat: number) {
  return {
    id: `00000000-0000-4000-8000-0000000002${id}`,
    name,
    locality,
    countryCode: "KR",
    lat,
    lng: 127,
    address: null,
    mapProvider: "naver",
    mapUrl: `https://map.naver.com/p/search/${name}`,
  } satisfies BookmarkPlace;
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
  place("01", "대오서점", "서촌", 37.58),
  place("02", "어니언", "안국", 37.57),
]);
const ramen = group("02", "대전 라멘 지도", [
  place("03", "이키야", "대전", 36.35),
]);
const walk = group("03", "주말 산책 코스", [
  place("04", "통인시장", "서촌", 37.58),
]);
const groups = [cafes, ramen, walk];

function createFakeMap() {
  let handlers: MapAdapterHandlers | null = null;
  let zoomListener: ((state: MapZoomState) => void) | null = null;
  const unsubscribeZoom = vi.fn();
  const adapter = {
    setMarkers: vi.fn<(markers: readonly MapMarkerView[]) => void>(),
    fitTo: vi.fn<(points: readonly MapPoint[]) => void>(),
    panTo: vi.fn<(point: MapPoint) => void>(),
    resize: vi.fn(),
    setControlsAtTop: vi.fn<(top: boolean) => void>(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    subscribeZoom: vi.fn((listener: (state: MapZoomState) => void) => {
      zoomListener = listener;
      listener({ canZoomIn: true, canZoomOut: true });
      return unsubscribeZoom;
    }),
    destroy: vi.fn(),
  } satisfies MapAdapter;
  const factory: MapAdapterFactory = vi.fn(async (_container, next) => {
    handlers = next;
    return adapter;
  });
  return {
    adapter,
    factory,
    unsubscribeZoom,
    emitZoom: (state: MapZoomState) => zoomListener?.(state),
    handlers: () => {
      if (!handlers) {
        throw new Error("adapter not created");
      }
      return handlers;
    },
    lastMarkers: () =>
      adapter.setMarkers.mock.calls.at(-1)?.[0] as MapMarkerView[],
  };
}

function renderScreen(overrides: Partial<PlaceMapScreenProps> = {}) {
  const map = createFakeMap();
  const props: PlaceMapScreenProps = {
    groups,
    isLoading: false,
    hasError: false,
    query: "",
    onQueryChange: vi.fn(),
    createAdapter: map.factory,
    onOpenNaverMap: vi.fn(),
    ...overrides,
  };
  const view = render(<PlaceMapScreen {...props} />);
  return { ...view, map, props };
}

describe("PlaceMapScreen", () => {
  it("colors markers per post, numbers them within the post, and fits all markers", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    expect(
      map.lastMarkers().map((marker) => [marker.label, marker.color]),
    ).toEqual([
      ["1", GROUP_COLORS[0]],
      ["2", GROUP_COLORS[0]],
      ["1", GROUP_COLORS[1]],
      ["1", GROUP_COLORS[2]],
    ]);
    expect(map.lastMarkers().every((marker) => marker.state === "normal")).toBe(
      true,
    );
    expect(map.adapter.fitTo).toHaveBeenLastCalledWith([
      { lat: 37.58, lng: 127 },
      { lat: 37.57, lng: 127 },
      { lat: 36.35, lng: 127 },
      { lat: 37.58, lng: 127 },
    ]);
    const list = screen.getByRole("list", { name: "게시물 그룹" });
    expect(
      within(list).getAllByRole("button", { name: /카페|라멘|산책/ }),
    ).toHaveLength(3);
    expect(screen.getByText("장소 2곳")).toBeTruthy();
  });

  it("highlights only the selected post, dims the rest, and fits its markers", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /대전 라멘 지도/ }));

    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.state)).toEqual([
        "dim",
        "dim",
        "active",
        "dim",
      ]),
    );
    expect(map.adapter.fitTo).toHaveBeenLastCalledWith([
      { lat: 36.35, lng: 127 },
    ]);
    expect(screen.getByRole("link", { name: "대전 라멘 지도" })).toBeTruthy();
    expect(screen.getByText("이키야")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
    await waitFor(() =>
      expect(
        map.lastMarkers().every((marker) => marker.state === "normal"),
      ).toBe(true),
    );
    expect(map.adapter.fitTo.mock.lastCall?.[0]).toHaveLength(4);
  });

  it("selects a post from a marker click and clears it on a background click", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    act(() => map.handlers().onMarkerClick(cafes.places[1]?.id ?? ""));
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.state)).toEqual([
        "active",
        "active",
        "dim",
        "dim",
      ]),
    );

    act(() => map.handlers().onBackgroundClick());
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "게시물 그룹" })).toBeTruthy(),
    );
  });

  it("opens with the requested post selected", async () => {
    const { map } = renderScreen({ initialBookmarkId: walk.bookmark.id });
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.state)).toEqual([
        "dim",
        "dim",
        "dim",
        "active",
      ]),
    );
    expect(screen.getByRole("link", { name: "주말 산책 코스" })).toBeTruthy();
  });

  it("pans to a place row and opens Naver Map from its button", async () => {
    const { map, props } = renderScreen({
      initialBookmarkId: cafes.bookmark.id,
    });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    fireEvent.click(screen.getByText("어니언"));
    expect(map.adapter.panTo).toHaveBeenCalledWith({ lat: 37.57, lng: 127 });

    fireEvent.click(
      screen.getByRole("button", { name: "어니언 네이버지도에서 열기" }),
    );
    expect(props.onOpenNaverMap).toHaveBeenCalledWith(cafes.places[1]);
  });

  it("narrows markers and the list to the search result while keeping group colors", async () => {
    const { map } = renderScreen({ query: "서촌 카페" });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    // "서촌 카페": 제목에 모두 일치하는 게시물 하나만 남고, 장소 전부가 유지된다.
    expect(
      map.lastMarkers().map((marker) => [marker.id, marker.color]),
    ).toEqual(cafes.places.map((item) => [item.id, GROUP_COLORS[0]]));
    expect(
      within(screen.getByRole("list", { name: "게시물 그룹" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
  });

  it("shows which places matched when only places match the query", async () => {
    const { map } = renderScreen({ query: "서촌 통인" });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    expect(map.lastMarkers().map((marker) => marker.color)).toEqual([
      GROUP_COLORS[2],
    ]);
    expect(screen.getByText("통인시장 · 서촌")).toBeTruthy();
  });

  it("shows an empty-result message and no markers when nothing matches", async () => {
    const { map } = renderScreen({ query: "존재하지않는검색어" });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();
    expect(map.lastMarkers()).toEqual([]);
  });

  it("clears the selection when the selected post drops out of the results", async () => {
    const { map, rerender, props } = renderScreen({
      initialBookmarkId: cafes.bookmark.id,
    });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "선택 해제" })).toBeTruthy();

    rerender(<PlaceMapScreen {...props} query="이키야" />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "선택 해제" })).toBeNull(),
    );
    expect(map.lastMarkers().map((marker) => marker.state)).toEqual(["normal"]);
  });

  it("debounces the search input into the URL query", async () => {
    const { props } = renderScreen();
    const input = screen.getByRole("searchbox", { name: "지도 검색" });

    fireEvent.change(input, { target: { value: "서" } });
    fireEvent.change(input, { target: { value: "서촌" } });
    expect(props.onQueryChange).not.toHaveBeenCalled();

    await waitFor(() => expect(props.onQueryChange).toHaveBeenCalledTimes(1));
    expect(props.onQueryChange).toHaveBeenCalledWith("서촌");
  });

  it("shows a notice instead of the map when the key is missing, but keeps the list working", () => {
    renderScreen({ createAdapter: null });
    expect(screen.getByRole("status").textContent).toContain(
      "VITE_NAVER_MAP_CLIENT_ID",
    );
    fireEvent.click(screen.getByRole("button", { name: /대전 라멘 지도/ }));
    expect(screen.getByText("이키야")).toBeTruthy();
  });

  it("falls back to the notice when the SDK fails to load or authenticate", async () => {
    const failing: MapAdapterFactory = vi.fn(async () => {
      throw new Error("sdk failed");
    });
    renderScreen({ createAdapter: failing });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "지도를 불러오지 못했어요",
      ),
    );
    expect(screen.getByRole("list", { name: "게시물 그룹" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "확대" })).toBeNull();

    cleanup();
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    act(() => map.handlers().onAuthFailure());
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("인증에 실패"),
    );
    expect(screen.queryByRole("button", { name: "확대" })).toBeNull();
    expect(screen.queryByRole("button", { name: "축소" })).toBeNull();
  });

  describe("zoom buttons", () => {
    it("calls the adapter zoom API", async () => {
      const { map } = renderScreen();
      fireEvent.click(await screen.findByRole("button", { name: "확대" }));
      expect(map.adapter.zoomIn).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "축소" }));
      expect(map.adapter.zoomOut).toHaveBeenCalledTimes(1);
    });

    it("disables a button at the zoom limit and re-enables it when the zoom changes", async () => {
      const { map } = renderScreen();
      const zoomIn = await screen.findByRole("button", { name: "확대" });
      const zoomOut = screen.getByRole("button", { name: "축소" });
      expect((zoomIn as HTMLButtonElement).disabled).toBe(false);

      act(() => map.emitZoom({ canZoomIn: false, canZoomOut: true }));
      expect((zoomIn as HTMLButtonElement).disabled).toBe(true);
      expect((zoomOut as HTMLButtonElement).disabled).toBe(false);

      act(() => map.emitZoom({ canZoomIn: true, canZoomOut: false }));
      expect((zoomIn as HTMLButtonElement).disabled).toBe(false);
      expect((zoomOut as HTMLButtonElement).disabled).toBe(true);
    });

    it("is hidden without a map key and unsubscribes on unmount", async () => {
      renderScreen({ createAdapter: null });
      expect(screen.queryByRole("button", { name: "확대" })).toBeNull();
      cleanup();

      const { map, unmount } = renderScreen();
      await screen.findByRole("button", { name: "확대" });
      unmount();
      expect(map.unsubscribeZoom).toHaveBeenCalled();
    });
  });

  it("shows empty, loading, and error states", () => {
    renderScreen({ groups: [] });
    expect(screen.getByText("지도에 표시할 장소가 없습니다")).toBeTruthy();
    cleanup();
    renderScreen({ groups: [], isLoading: true });
    expect(screen.getByText("장소를 불러오는 중…")).toBeTruthy();
    cleanup();
    renderScreen({ groups: [], hasError: true });
    expect(screen.getByRole("alert").textContent).toContain(
      "불러오지 못했어요",
    );
  });

  it("gives the SDK a container that fills an absolutely positioned wrapper", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.factory).toHaveBeenCalled());

    // 네이버 SDK는 컨테이너 style을 position: relative로 덮어쓴다. 그래도 높이가
    // 접히지 않도록 컨테이너 자신은 absolute inset-0 이 아니라 h-full w-full 이어야 한다.
    const container = vi.mocked(map.factory).mock.calls[0]?.[0];
    expect(container?.className).toContain("h-full");
    expect(container?.className).toContain("w-full");
    expect(container?.className).not.toContain("absolute");
    expect(container?.parentElement?.className).toContain("absolute");
    expect(container?.parentElement?.className).toContain("inset-0");
  });

  it("renders the search box with the in-flow search-field layout so the icon never overlaps the text", () => {
    renderScreen();

    const input = screen.getByRole("searchbox", { name: "지도 검색" });
    // .input은 unlayered px-3 이라 유틸리티 pl-9 를 이긴다. 아이콘은 흐름 안에 둔다.
    expect(input.classList.contains("input")).toBe(false);
    const field = input.closest("label");
    expect(field?.classList.contains("search-field")).toBe(true);
    expect(field?.querySelector("svg")).not.toBeNull();
  });

  describe("hover highlight", () => {
    const ramenRow = () =>
      screen
        .getByRole("button", { name: /대전 라멘 지도/ })
        .closest("li") as HTMLElement;

    it("highlights the hovered post like a selection without moving the map, then restores", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.fitTo).toHaveBeenCalledTimes(1));

      fireEvent.pointerEnter(ramenRow(), { pointerType: "mouse" });
      await waitFor(() =>
        expect(map.lastMarkers().map((marker) => marker.state)).toEqual([
          "dim",
          "dim",
          "active",
          "dim",
        ]),
      );
      expect(map.adapter.fitTo).toHaveBeenCalledTimes(1);

      fireEvent.pointerLeave(ramenRow());
      await waitFor(() =>
        expect(
          map.lastMarkers().every((marker) => marker.state === "normal"),
        ).toBe(true),
      );
      expect(map.adapter.fitTo).toHaveBeenCalledTimes(1);
    });

    it("applies the same highlight on keyboard focus and blur", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

      fireEvent.focus(screen.getByRole("button", { name: /대전 라멘 지도/ }));
      await waitFor(() =>
        expect(
          map.lastMarkers().filter((m) => m.state === "active"),
        ).toHaveLength(1),
      );

      fireEvent.blur(screen.getByRole("button", { name: /대전 라멘 지도/ }), {
        relatedTarget: document.body,
      });
      await waitFor(() =>
        expect(
          map.lastMarkers().every((marker) => marker.state === "normal"),
        ).toBe(true),
      );
    });

    it("ignores touch pointers", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

      fireEvent.pointerEnter(ramenRow(), { pointerType: "touch" });

      expect(
        map.lastMarkers().every((marker) => marker.state === "normal"),
      ).toBe(true);
    });

    it("emphasizes just the hovered place marker inside a selected post", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
      fireEvent.click(
        screen.getByRole("button", { name: /서촌 카페 6곳 추천/ }),
      );
      await waitFor(() =>
        expect(screen.getByRole("list", { name: "장소" })).toBeTruthy(),
      );

      const row = within(
        screen.getByRole("list", { name: "장소" }),
      ).getAllByRole("listitem")[1];
      fireEvent.pointerEnter(row as HTMLElement, { pointerType: "mouse" });
      await waitFor(() =>
        expect(
          map
            .lastMarkers()
            .filter((marker) => marker.emphasized)
            .map((m) => m.id),
        ).toEqual([cafes.places[1]?.id]),
      );

      fireEvent.pointerLeave(row as HTMLElement);
      await waitFor(() =>
        expect(map.lastMarkers().some((marker) => marker.emphasized)).toBe(
          false,
        ),
      );
      expect(
        map.lastMarkers().filter((marker) => marker.state === "active"),
      ).toHaveLength(2);
    });
  });

  describe("map visibility toggle", () => {
    const toggleOf = (title: RegExp) =>
      within(
        screen
          .getByRole("button", { name: title })
          .closest("li") as HTMLElement,
      ).getByRole("button", { name: /지도에서 숨기기|지도에 표시/ });

    it("removes a hidden post's markers and fit points, keeps it in the list dimmed, and persists it", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.fitTo).toHaveBeenCalledTimes(1));

      const toggle = toggleOf(/서촌 카페 6곳 추천/);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(toggle);

      await waitFor(() =>
        expect(map.lastMarkers().map((marker) => marker.groupId)).toEqual([
          ramen.bookmark.id,
          walk.bookmark.id,
        ]),
      );
      expect(map.adapter.fitTo).toHaveBeenLastCalledWith([
        { lat: 36.35, lng: 127 },
        { lat: 37.58, lng: 127 },
      ]);
      // 그룹 색은 전체 목록 기준이라 그대로다.
      expect(map.lastMarkers().map((marker) => marker.color)).toEqual([
        GROUP_COLORS[1],
        GROUP_COLORS[2],
      ]);
      const hiddenToggle = toggleOf(/서촌 카페 6곳 추천/);
      expect(hiddenToggle.getAttribute("aria-label")).toBe("지도에 표시");
      expect(hiddenToggle.getAttribute("aria-pressed")).toBe("true");
      expect(
        screen.getByRole("button", { name: /서촌 카페 6곳 추천/ }).className,
      ).toContain("opacity-50");
      expect(
        JSON.parse(
          window.localStorage.getItem("my-bookmark:map-hidden-groups") ?? "[]",
        ),
      ).toEqual([cafes.bookmark.id]);
    });

    it("restores everything with the 'show all hidden' button", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /모두 표시/ })).toBeNull();

      fireEvent.click(toggleOf(/서촌 카페 6곳 추천/));
      fireEvent.click(toggleOf(/대전 라멘 지도/));
      const showAll = await screen.findByRole("button", {
        name: "숨긴 2개 모두 표시",
      });
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(1));

      fireEvent.click(showAll);

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
      expect(screen.queryByRole("button", { name: /모두 표시/ })).toBeNull();
      expect(
        window.localStorage.getItem("my-bookmark:map-hidden-groups"),
      ).toBeNull();
    });

    it("shows a hidden post again when it is selected", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
      fireEvent.click(toggleOf(/대전 라멘 지도/));
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));

      fireEvent.click(screen.getByRole("button", { name: /대전 라멘 지도/ }));

      await waitFor(() =>
        expect(
          map.lastMarkers().filter((marker) => marker.state === "active"),
        ).toHaveLength(1),
      );
      expect(
        window.localStorage.getItem("my-bookmark:map-hidden-groups"),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
    });

    it("reads the hidden set from localStorage on open", async () => {
      window.localStorage.setItem(
        "my-bookmark:map-hidden-groups",
        JSON.stringify([walk.bookmark.id]),
      );
      const { map } = renderScreen();

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));
      expect(
        screen.getByRole("button", { name: "숨긴 1개 모두 표시" }),
      ).toBeTruthy();
    });

    it("counts hidden posts among the search results only", async () => {
      window.localStorage.setItem(
        "my-bookmark:map-hidden-groups",
        JSON.stringify([walk.bookmark.id, ramen.bookmark.id]),
      );
      renderScreen({ query: "서촌" });

      // "서촌"은 카페 게시물과 산책 게시물(통인시장 · 서촌)에 걸리고, 산책만 숨김이다.
      expect(
        await screen.findByRole("button", { name: "숨긴 1개 모두 표시" }),
      ).toBeTruthy();
    });

    it("keeps working when localStorage is blocked", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      const { map } = renderScreen();
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));

      fireEvent.click(toggleOf(/서촌 카페 6곳 추천/));

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(2));
    });
  });

  describe("individual place visibility", () => {
    const PLACES_KEY = "my-bookmark:map-hidden-places";
    const cafeIds = cafes.places.map((item) => item.id);
    const [firstCafe, secondCafe] = cafeIds as [string, string];

    const selectCafes = () =>
      fireEvent.click(
        screen.getByRole("button", { name: /서촌 카페 6곳 추천/ }),
      );
    const placeToggles = () =>
      within(screen.getByRole("list", { name: "장소" })).getAllByRole(
        "button",
        {
          name: /이 장소 지도에서 숨기기|이 장소 지도에 표시/,
        },
      );
    const groupToggle = (title: RegExp) =>
      within(
        screen
          .getByRole("button", { name: title })
          .closest("li") as HTMLElement,
      ).getByRole("button", { name: /^지도에서 숨기기$|^지도에 표시$/ });

    it("hides one pin from markers and fit points, dims the row, persists it, and shows the count on the group row", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
      selectCafes();
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));

      const [toggle] = placeToggles();
      expect(toggle?.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(toggle as HTMLElement);

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));
      expect(map.lastMarkers().map((marker) => marker.id)).not.toContain(
        firstCafe,
      );
      expect(map.adapter.fitTo).toHaveBeenLastCalledWith([
        { lat: 37.57, lng: 127 },
      ]);
      const [hiddenToggle] = placeToggles();
      expect(hiddenToggle?.getAttribute("aria-label")).toBe(
        "이 장소 지도에 표시",
      );
      expect(hiddenToggle?.getAttribute("aria-pressed")).toBe("true");
      expect(
        screen.getByRole("button", { name: /^대오서점(?! 네이버)/ }).className,
      ).toContain("opacity-50");
      expect(
        JSON.parse(window.localStorage.getItem(PLACES_KEY) ?? "[]"),
      ).toEqual([firstCafe]);

      fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
      const row = screen
        .getByRole("button", { name: /서촌 카페 6곳 추천/ })
        .closest("li") as HTMLElement;
      expect(row.textContent).toContain("장소 2곳 (1곳 숨김)");
      expect(
        screen.getByRole("button", { name: "숨긴 1개 모두 표시" }),
      ).toBeTruthy();
    });

    it("shows the pin again when toggled back", async () => {
      const { map } = renderScreen();
      await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
      selectCafes();
      fireEvent.click(placeToggles()[0] as HTMLElement);
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));

      fireEvent.click(placeToggles()[0] as HTMLElement);

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
      expect(window.localStorage.getItem(PLACES_KEY)).toBeNull();
    });

    it("lets a hidden group win and keeps the individual state when the group is shown again", async () => {
      window.localStorage.setItem(PLACES_KEY, JSON.stringify([secondCafe]));
      const { map } = renderScreen();
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));

      fireEvent.click(groupToggle(/서촌 카페 6곳 추천/));
      await waitFor(() =>
        expect(map.lastMarkers().map((marker) => marker.groupId)).toEqual([
          ramen.bookmark.id,
          walk.bookmark.id,
        ]),
      );

      fireEvent.click(groupToggle(/서촌 카페 6곳 추천/));
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(3));
      expect(map.lastMarkers().map((marker) => marker.id)).not.toContain(
        secondCafe,
      );
    });

    it("clears both group and place hiding with the 'show all hidden' button", async () => {
      window.localStorage.setItem(PLACES_KEY, JSON.stringify([secondCafe]));
      window.localStorage.setItem(
        "my-bookmark:map-hidden-groups",
        JSON.stringify([walk.bookmark.id]),
      );
      const { map } = renderScreen();
      const showAll = await screen.findByRole("button", {
        name: "숨긴 2개 모두 표시",
      });
      await waitFor(() => expect(map.lastMarkers()).toHaveLength(2));

      fireEvent.click(showAll);

      await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
      expect(window.localStorage.getItem(PLACES_KEY)).toBeNull();
      expect(
        window.localStorage.getItem("my-bookmark:map-hidden-groups"),
      ).toBeNull();
    });
  });

  it("destroys the map on unmount", async () => {
    const { map, unmount } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    unmount();
    expect(map.adapter.destroy).toHaveBeenCalled();
  });
});

function mockViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  document.documentElement.classList.remove("map-screen-lock");
});

const sheet = () => screen.getByRole("complementary", { name: "장소 목록" });
const handle = () =>
  within(sheet()).getByRole("button", { name: /목록 (펼치기|접기)/ });
const mapSection = () => screen.getByRole("region", { name: "지도" });

describe("PlaceMapScreen on a phone (bottom sheet)", () => {
  it("starts collapsed with a one-line summary and an inert list", async () => {
    mockViewport(true);
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    expect(sheet().getAttribute("data-state")).toBe("collapsed");
    expect(handle().getAttribute("aria-expanded")).toBe("false");
    expect(handle().textContent).toContain("게시물 3개");
    expect(
      sheet().querySelector("#map-sheet-body")?.hasAttribute("inert"),
    ).toBe(true);
    expect(document.documentElement.classList.contains("map-screen-lock")).toBe(
      true,
    );
  });

  it("expands from the handle by tap, keyboard click, and drag, and collapses again", async () => {
    mockViewport(true);
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    // 탭(포인터 down/up, 이동 없음)
    fireEvent.pointerDown(handle(), { clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 601, pointerId: 1 });
    expect(sheet().getAttribute("data-state")).toBe("expanded");
    expect(
      sheet().querySelector("#map-sheet-body")?.hasAttribute("inert"),
    ).toBe(false);

    // 아래로 끌면 접힘
    fireEvent.pointerDown(handle(), { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 380, pointerId: 1 });
    expect(sheet().getAttribute("data-state")).toBe("collapsed");

    // 위로 끌면 펼침
    fireEvent.pointerDown(handle(), { clientY: 600, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientY: 500, pointerId: 1 });
    expect(sheet().getAttribute("data-state")).toBe("expanded");

    // 키보드(Enter/Space는 detail 0 click)
    fireEvent.click(handle());
    expect(sheet().getAttribute("data-state")).toBe("collapsed");
  });

  it("collapses when the map is tapped or dragged and keeps the selection and its title", async () => {
    mockViewport(true);
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    act(() => map.handlers().onMarkerClick(ramen.places[0]?.id ?? ""));
    await waitFor(() =>
      expect(sheet().getAttribute("data-state")).toBe("expanded"),
    );
    expect(
      within(sheet()).getByRole("link", { name: "대전 라멘 지도" }),
    ).toBeTruthy();

    act(() => map.handlers().onBackgroundClick());
    expect(sheet().getAttribute("data-state")).toBe("collapsed");
    // 선택은 유지되고 접힌 시트가 선택된 제목을 보여 준다.
    expect(handle().textContent).toContain("대전 라멘 지도");
    expect(map.lastMarkers().map((marker) => marker.state)).toContain("active");

    fireEvent.click(handle());
    expect(sheet().getAttribute("data-state")).toBe("expanded");
    act(() => map.handlers().onMapDragStart());
    expect(sheet().getAttribute("data-state")).toBe("collapsed");
  });

  it("expands the sheet when a post is selected from the list, and collapses it on a place row", async () => {
    mockViewport(true);
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    fireEvent.click(handle());
    fireEvent.click(
      within(sheet()).getByRole("button", { name: /서촌 카페 6곳 추천/ }),
    );
    expect(sheet().getAttribute("data-state")).toBe("expanded");

    fireEvent.click(within(sheet()).getByText("어니언"));
    expect(sheet().getAttribute("data-state")).toBe("collapsed");
    expect(map.adapter.panTo).toHaveBeenCalledWith({ lat: 37.57, lng: 127 });
  });

  it("opens expanded when a post or a query is already requested", () => {
    mockViewport(true);
    renderScreen({ initialBookmarkId: walk.bookmark.id });
    expect(sheet().getAttribute("data-state")).toBe("expanded");
    cleanup();
    renderScreen({ query: "서촌" });
    expect(sheet().getAttribute("data-state")).toBe("expanded");
  });

  it("moves the search box onto the map: it expands the sheet, and X clears it", async () => {
    mockViewport(true);
    const { map, props } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    const input = screen.getByRole("searchbox", { name: "지도 검색" });
    expect(mapSection().contains(input)).toBe(true);
    expect(sheet().contains(input)).toBe(false);
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "검색어 지우기" })).toBeNull();

    fireEvent.change(input, { target: { value: "서촌" } });
    expect(sheet().getAttribute("data-state")).toBe("expanded");
    const clear = screen.getByRole("button", { name: "검색어 지우기" });

    fireEvent.click(clear);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "검색어 지우기" })).toBeNull();
    expect(props.onQueryChange).not.toHaveBeenCalledWith("서촌");
  });

  it("pushes an emptied search into the URL query after the debounce", async () => {
    mockViewport(true);
    const { props } = renderScreen({ query: "서촌" });
    const input = screen.getByRole("searchbox", {
      name: "지도 검색",
    }) as HTMLInputElement;
    expect(input.value).toBe("서촌");

    fireEvent.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect(input.value).toBe("");
    await waitFor(() => expect(props.onQueryChange).toHaveBeenCalledWith(""));
  });

  it("keeps the zoom buttons and the search bar apart on the map", async () => {
    mockViewport(true);
    renderScreen();
    const zoom = await screen.findByRole("button", { name: "확대" });
    expect(zoom.closest(".map-zoom-group")?.classList).toContain(
      "glass-surface",
    );
    expect(
      screen.getByRole("searchbox", { name: "지도 검색" }).closest("div")
        ?.classList,
    ).toContain("map-search-bar");
  });

  it("moves the NAVER logo and copyright to the top on a phone and fills the screen below", async () => {
    mockViewport(true);
    const { map } = renderScreen();
    await waitFor(() =>
      expect(map.adapter.setControlsAtTop).toHaveBeenCalled(),
    );
    expect(map.adapter.setControlsAtTop).toHaveBeenLastCalledWith(true);

    // 지도 컨테이너를 접힌 시트 높이만큼 자르지 않는다(아래까지 찬다).
    const wrapper = vi.mocked(map.factory).mock.calls[0]?.[0]?.parentElement;
    expect(wrapper?.className).not.toMatch(/bottom-/);
    expect(wrapper?.className).toContain("inset-0");
  });

  it("tells the SDK to resize when the map container changes size", async () => {
    mockViewport(true);
    let notify: (() => void) | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { map, unmount } = renderScreen();
    await waitFor(() => expect(observe).toHaveBeenCalled());

    act(() => notify?.());
    expect(map.adapter.resize).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("PlaceMapScreen on desktop keeps its layout", () => {
  it("has no sheet handle or floating search bar and clears the selection on a background click", async () => {
    mockViewport(false);
    const { map } = renderScreen({ initialBookmarkId: ramen.bookmark.id });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: /목록 (펼치기|접기)/ }),
    ).toBeNull();
    expect(
      sheet().contains(screen.getByRole("searchbox", { name: "지도 검색" })),
    ).toBe(true);
    expect(sheet().classList).toContain("surface");
    expect(sheet().classList).not.toContain("glass-surface");
    expect(document.documentElement.classList.contains("map-screen-lock")).toBe(
      false,
    );

    act(() => map.handlers().onBackgroundClick());
    await waitFor(() =>
      expect(
        map.lastMarkers().every((marker) => marker.state === "normal"),
      ).toBe(true),
    );
  });
});

describe("NAVER logo placement on desktop", () => {
  it("keeps the logo and copyright at their default bottom corners", async () => {
    mockViewport(false);
    const { map } = renderScreen();
    await waitFor(() =>
      expect(map.adapter.setControlsAtTop).toHaveBeenCalled(),
    );
    expect(map.adapter.setControlsAtTop).toHaveBeenLastCalledWith(false);
  });
});

describe("only the selected post (shared by phone and desktop)", () => {
  const ONLY_KEY = "my-bookmark:map-only-selected";
  const toggle = () =>
    screen.getByRole("switch", { name: "선택한 게시물만 보기" });

  it("shows the switch only while a post is selected, in the selection panel header area", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    expect(screen.queryByRole("switch")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /대전 라멘 지도/ }));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    // 제목 링크와 장소 목록 사이에 있다.
    const title = screen.getByRole("link", { name: "대전 라멘 지도" });
    const places = screen.getByRole("list", { name: "장소" });
    expect(
      title.compareDocumentPosition(toggle()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toggle().compareDocumentPosition(places) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("removes the other posts' markers when on, dims them again when off, and returns to all on deselect", async () => {
    const { map } = renderScreen();
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /대전 라멘 지도/ }));
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.state)).toEqual([
        "dim",
        "dim",
        "active",
        "dim",
      ]),
    );

    fireEvent.click(toggle());
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.groupId)).toEqual([
        ramen.bookmark.id,
      ]),
    );
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem(ONLY_KEY)).toBe("1");

    fireEvent.click(toggle());
    await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
    expect(window.localStorage.getItem(ONLY_KEY)).toBeNull();

    fireEvent.click(toggle());
    await waitFor(() => expect(map.lastMarkers()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
    await waitFor(() => expect(map.lastMarkers()).toHaveLength(4));
    expect(map.lastMarkers().every((marker) => marker.state === "normal")).toBe(
      true,
    );
  });

  it("restores the saved option for the next visit", async () => {
    window.localStorage.setItem(ONLY_KEY, "1");
    const { map } = renderScreen({ initialBookmarkId: walk.bookmark.id });
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.groupId)).toEqual([
        walk.bookmark.id,
      ]),
    );
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("keeps individual place hiding and place hover working inside the selected post", async () => {
    const { map } = renderScreen({ initialBookmarkId: cafes.bookmark.id });
    await waitFor(() => expect(map.adapter.setMarkers).toHaveBeenCalled());
    fireEvent.click(toggle());

    const hideButtons = screen.getAllByRole("button", {
      name: "이 장소 지도에서 숨기기",
    });
    fireEvent.click(hideButtons[0] as HTMLElement);
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.id)).toEqual([
        cafes.places[1]?.id,
      ]),
    );

    const row = screen.getByText("어니언").closest("li") as HTMLElement;
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    await waitFor(() =>
      expect(map.lastMarkers().map((marker) => marker.emphasized)).toEqual([
        true,
      ]),
    );
  });
});
