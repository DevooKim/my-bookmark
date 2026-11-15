import type { BookmarkPlace, PlaceGroup } from "@my-bookmark/shared";
import { describe, expect, it } from "vitest";
import { GROUP_COLORS } from "./map-adapter";
import {
  computeFitPoints,
  computeMapMarkers,
  type MapViewInput,
} from "./map-view";

function place(id: string, lat: number | null, lng = 127): BookmarkPlace {
  return {
    id,
    name: `place-${id}`,
    locality: null,
    countryCode: "KR",
    lat,
    lng: lat === null ? null : lng,
    address: null,
    mapProvider: "naver",
    mapUrl: "https://map.naver.com/",
  };
}

function group(id: string, places: BookmarkPlace[]): PlaceGroup {
  return {
    bookmark: {
      id,
      kind: "link",
      title: `title-${id}`,
      url: `https://example.com/${id}`,
      thumbnailUrl: null,
    },
    places,
  };
}

const a = group("a", [place("a1", 37.1), place("a2", 37.2)]);
const b = group("b", [place("b1", 36.1)]);
const c = group("c", [place("c1", 35.1)]);
const all = [a, b, c];

function input(overrides: Partial<MapViewInput> = {}): MapViewInput {
  return {
    results: all.map((g) => ({
      group: g,
      places: g.places,
      titleMatched: false,
    })),
    colorIndex: new Map(all.map((g, index) => [g.bookmark.id, index])),
    selectedId: null,
    hoveredGroupId: null,
    hoveredPlaceId: null,
    hiddenIds: new Set(),
    hiddenPlaceIds: new Set(),
    ...overrides,
  };
}

const states = (markers: ReturnType<typeof computeMapMarkers>) =>
  markers.map((marker) => [marker.id, marker.state, marker.emphasized]);

describe("computeMapMarkers", () => {
  it("shows every marker as normal when nothing is selected, hovered or hidden", () => {
    expect(states(computeMapMarkers(input()))).toEqual([
      ["a1", "normal", false],
      ["a2", "normal", false],
      ["b1", "normal", false],
      ["c1", "normal", false],
    ]);
  });

  it("highlights the hovered group and dims the rest, like a selection", () => {
    const hovered = states(computeMapMarkers(input({ hoveredGroupId: "b" })));
    const selected = states(computeMapMarkers(input({ selectedId: "b" })));
    expect(hovered).toEqual([
      ["a1", "dim", false],
      ["a2", "dim", false],
      ["b1", "active", false],
      ["c1", "dim", false],
    ]);
    expect(hovered).toEqual(selected);
  });

  it("lets the selection win over a stale group hover", () => {
    const markers = computeMapMarkers(
      input({ selectedId: "a", hoveredGroupId: "b" }),
    );
    expect(markers.find((marker) => marker.id === "b1")?.state).toBe("dim");
    expect(markers.find((marker) => marker.id === "a1")?.state).toBe("active");
  });

  it("emphasizes only the hovered place inside the selected group", () => {
    const markers = computeMapMarkers(
      input({ selectedId: "a", hoveredPlaceId: "a2" }),
    );
    expect(states(markers)).toEqual([
      ["a1", "active", false],
      ["a2", "active", true],
      ["b1", "dim", false],
      ["c1", "dim", false],
    ]);
  });

  it("ignores a place hover when no group is selected", () => {
    const markers = computeMapMarkers(input({ hoveredPlaceId: "a1" }));
    expect(markers.every((marker) => !marker.emphasized)).toBe(true);
  });

  it("drops hidden groups but keeps colors fixed to the full list order", () => {
    const markers = computeMapMarkers(input({ hiddenIds: new Set(["a"]) }));
    expect(markers.map((marker) => marker.id)).toEqual(["b1", "c1"]);
    expect(markers.map((marker) => marker.color)).toEqual([
      GROUP_COLORS[1],
      GROUP_COLORS[2],
    ]);
  });

  it("does not dim others when a hidden group is hovered", () => {
    const markers = computeMapMarkers(
      input({ hiddenIds: new Set(["a"]), hoveredGroupId: "a" }),
    );
    expect(markers.every((marker) => marker.state === "normal")).toBe(true);
  });

  it("keeps a selected group visible even if it is still in the hidden set", () => {
    const markers = computeMapMarkers(
      input({ hiddenIds: new Set(["a"]), selectedId: "a" }),
    );
    expect(markers.map((marker) => marker.id)).toEqual([
      "a1",
      "a2",
      "b1",
      "c1",
    ]);
  });

  it("drops individually hidden places but keeps the remaining labels stable", () => {
    const markers = computeMapMarkers(
      input({ hiddenPlaceIds: new Set(["a1"]) }),
    );
    expect(markers.map((marker) => [marker.id, marker.label])).toEqual([
      ["a2", "2"],
      ["b1", "1"],
      ["c1", "1"],
    ]);
  });

  it("lets a hidden group win over individual place state", () => {
    const markers = computeMapMarkers(
      input({ hiddenIds: new Set(["a"]), hiddenPlaceIds: new Set(["b1"]) }),
    );
    expect(markers.map((marker) => marker.id)).toEqual(["c1"]);
  });

  it("still hides individually hidden places inside the selected group", () => {
    const markers = computeMapMarkers(
      input({ selectedId: "a", hiddenPlaceIds: new Set(["a1"]) }),
    );
    expect(states(markers)).toEqual([
      ["a2", "active", false],
      ["b1", "dim", false],
      ["c1", "dim", false],
    ]);
  });

  it("does not dim others when every place of the hovered group is hidden", () => {
    const markers = computeMapMarkers(
      input({
        hoveredGroupId: "a",
        hiddenPlaceIds: new Set(["a1", "a2"]),
      }),
    );
    expect(markers.every((marker) => marker.state === "normal")).toBe(true);
  });

  it("skips places without coordinates", () => {
    const partial = group("p", [place("p1", null), place("p2", 34)]);
    const markers = computeMapMarkers(
      input({
        results: [
          { group: partial, places: partial.places, titleMatched: false },
        ],
      }),
    );
    expect(markers.map((marker) => marker.id)).toEqual(["p2"]);
  });
});

describe("computeFitPoints", () => {
  it("fits all visible results and leaves hidden groups out", () => {
    const base = input();
    expect(
      computeFitPoints({ ...base, hiddenIds: new Set(["a", "c"]) }),
    ).toEqual([{ lat: 36.1, lng: 127 }]);
  });

  it("fits only the selected group even if it was hidden", () => {
    const base = input();
    expect(
      computeFitPoints({ ...base, selectedId: "a", hiddenIds: new Set(["a"]) }),
    ).toEqual([
      { lat: 37.1, lng: 127 },
      { lat: 37.2, lng: 127 },
    ]);
  });

  it("leaves individually hidden places out, also inside the selected group", () => {
    const base = input();
    expect(
      computeFitPoints({ ...base, hiddenPlaceIds: new Set(["a1", "b1"]) }),
    ).toEqual([
      { lat: 37.2, lng: 127 },
      { lat: 35.1, lng: 127 },
    ]);
    expect(
      computeFitPoints({
        ...base,
        selectedId: "a",
        hiddenPlaceIds: new Set(["a1"]),
      }),
    ).toEqual([{ lat: 37.2, lng: 127 }]);
  });

  it("is empty when every group is hidden", () => {
    const base = input();
    expect(
      computeFitPoints({ ...base, hiddenIds: new Set(["a", "b", "c"]) }),
    ).toEqual([]);
  });
});

describe("only-selected mode", () => {
  it("removes every other post from the map instead of dimming it", () => {
    expect(
      states(computeMapMarkers(input({ selectedId: "b", onlySelected: true }))),
    ).toEqual([["b1", "active", false]]);
    // 꺼져 있으면 지금처럼 나머지는 흐리게 남는다.
    expect(
      states(
        computeMapMarkers(input({ selectedId: "b", onlySelected: false })),
      ).map(([, state]) => state),
    ).toEqual(["dim", "dim", "active", "dim"]);
  });

  it("has no effect without a selection", () => {
    expect(
      computeMapMarkers(input({ onlySelected: true })).map(
        (marker) => marker.id,
      ),
    ).toEqual(["a1", "a2", "b1", "c1"]);
  });

  it("still applies the group hide rules and shows a selected hidden group", () => {
    // 선택된 그룹은 숨김이어도 보인다. 다른 그룹의 숨김은 선택·옵션과 무관하게 숨김이다.
    expect(
      states(
        computeMapMarkers(
          input({
            selectedId: "a",
            onlySelected: true,
            hiddenIds: new Set(["a", "b"]),
          }),
        ),
      ),
    ).toEqual([
      ["a1", "active", false],
      ["a2", "active", false],
    ]);
  });

  it("keeps individually hidden places hidden inside the selected post", () => {
    expect(
      computeMapMarkers(
        input({
          selectedId: "a",
          onlySelected: true,
          hiddenPlaceIds: new Set(["a1", "b1"]),
        }),
      ).map((marker) => marker.id),
    ).toEqual(["a2"]);
  });

  it("ignores the hovered post and only emphasizes places inside the selected post", () => {
    // 선택이 있으면 그룹 호버는 이미 무시된다. 옵션이 켜져 숨은 그룹의 호버는 마커를 되살리지 않는다.
    expect(
      states(
        computeMapMarkers(
          input({
            selectedId: "a",
            onlySelected: true,
            hoveredGroupId: "b",
            hoveredPlaceId: "a2",
          }),
        ),
      ),
    ).toEqual([
      ["a1", "active", false],
      ["a2", "active", true],
    ]);
    // 선택이 없으면 호버 강조는 그대로 동작한다.
    expect(
      computeMapMarkers(input({ onlySelected: true, hoveredGroupId: "b" })).map(
        (marker) => [marker.id, marker.state],
      ),
    ).toEqual([
      ["a1", "dim"],
      ["a2", "dim"],
      ["b1", "active"],
      ["c1", "dim"],
    ]);
  });

  it("fits only the selected post's visible places", () => {
    const base = input({ selectedId: "a", onlySelected: true });
    expect(computeFitPoints(base)).toEqual([
      { lat: 37.1, lng: 127 },
      { lat: 37.2, lng: 127 },
    ]);
  });
});
