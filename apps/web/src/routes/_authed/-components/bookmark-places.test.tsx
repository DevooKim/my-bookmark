import type { BookmarkPlace } from "@my-bookmark/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BookmarkPlaces } from "./bookmark-places";

afterEach(cleanup);

const bookmarkId = "00000000-0000-4000-8000-0000000000aa";

function place(index: number, overrides: Partial<BookmarkPlace> = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name: `장소 ${index}`,
    locality: "서촌",
    countryCode: "KR",
    lat: null,
    lng: null,
    address: null,
    mapProvider: "naver",
    mapUrl: `https://map.naver.com/p/search/place-${index}`,
    ...overrides,
  } satisfies BookmarkPlace;
}

describe("BookmarkPlaces", () => {
  it("renders nothing without places", () => {
    const { container } = render(
      <BookmarkPlaces bookmarkId={bookmarkId} places={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders each place as an external map link", () => {
    render(
      <BookmarkPlaces
        bookmarkId={bookmarkId}
        places={[
          place(1),
          place(2, {
            countryCode: "JP",
            mapProvider: "google",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=kyoto",
          }),
        ]}
      />,
    );
    const naver = screen.getByRole("link", { name: "장소 1" });
    expect(naver.getAttribute("href")).toBe(
      "https://map.naver.com/p/search/place-1",
    );
    expect(naver.getAttribute("target")).toBe("_blank");
    expect(naver.className).toContain("hover:bg-blue-700");
    expect(naver.className).not.toContain("03c75a");
    const google = screen.getByRole("link", { name: "장소 2" });
    expect(google.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=kyoto",
    );
    expect(google.className).toContain("hover:bg-blue-700");
  });

  it("collapses to three places with a +N button that expands the rest", () => {
    render(
      <BookmarkPlaces
        bookmarkId={bookmarkId}
        collapsible
        places={[1, 2, 3, 4, 5].map((index) => place(index))}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: "장소 4" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "장소 2개 더 보기" }));
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows every place when not collapsible", () => {
    render(
      <BookmarkPlaces
        bookmarkId={bookmarkId}
        places={[1, 2, 3, 4].map((index) => place(index))}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("links to the map only when a place has coordinates", () => {
    const { rerender } = render(
      <BookmarkPlaces bookmarkId={bookmarkId} places={[place(1)]} />,
    );
    expect(screen.queryByRole("link", { name: "지도에서 보기" })).toBeNull();

    rerender(
      <BookmarkPlaces
        bookmarkId={bookmarkId}
        places={[place(1), place(2, { lat: 37.5, lng: 127 })]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "지도에서 보기" }).getAttribute("href"),
    ).toBe(`/map?bookmark=${bookmarkId}`);
  });

  it("does not collapse exactly three places", () => {
    render(
      <BookmarkPlaces
        bookmarkId={bookmarkId}
        collapsible
        places={[1, 2, 3].map((index) => place(index))}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
