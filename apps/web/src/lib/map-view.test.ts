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

  it("is empty when every group is hidden", () => {
    const base = input();
    expect(
      computeFitPoints({ ...base, hiddenIds: new Set(["a", "b", "c"]) }),
    ).toEqual([]);
  });
});
