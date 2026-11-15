// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOBILE_MAP_QUERY, useMediaQuery } from "./use-media-query";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useMediaQuery", () => {
  it("is false when matchMedia is unavailable", () => {
    const { result } = renderHook(() => useMediaQuery(MOBILE_MAP_QUERY));
    expect(result.current).toBe(false);
  });

  it("follows the media query and stops listening on unmount", () => {
    let listener: (() => void) | null = null;
    const list = {
      matches: true,
      addEventListener: vi.fn((_type: string, next: () => void) => {
        listener = next;
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => list),
    });

    const { result, unmount } = renderHook(() =>
      useMediaQuery(MOBILE_MAP_QUERY),
    );
    expect(result.current).toBe(true);

    list.matches = false;
    act(() => listener?.());
    expect(result.current).toBe(false);

    unmount();
    expect(list.removeEventListener).toHaveBeenCalled();
  });
});
