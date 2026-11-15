// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_GROUPS_STORAGE_KEY,
  HIDDEN_PLACES_STORAGE_KEY,
  loadHiddenIds,
  loadHiddenPlaceIds,
  loadOnlySelected,
  ONLY_SELECTED_STORAGE_KEY,
  parseHiddenIds,
  saveHiddenIds,
  saveHiddenPlaceIds,
  saveOnlySelected,
  serializeHiddenIds,
} from "./map-visibility";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("hidden group serialization", () => {
  it("round-trips ids as a sorted, de-duplicated JSON array", () => {
    const raw = serializeHiddenIds(["b", "a", "b"]);
    expect(raw).toBe('["a","b"]');
    expect([...parseHiddenIds(raw)]).toEqual(["a", "b"]);
  });

  it.each([
    null,
    "",
    "not json",
    '{"a":1}',
    "[1,2]",
    '["ok",""]',
  ])("treats %j as nothing hidden", (raw) => {
    expect(parseHiddenIds(raw).size).toBe(0);
  });
});

describe("hidden group storage", () => {
  it("saves to and loads from localStorage, and clears the key when empty", () => {
    saveHiddenIds(new Set(["x", "y"]));
    expect(window.localStorage.getItem(HIDDEN_GROUPS_STORAGE_KEY)).toBe(
      '["x","y"]',
    );
    expect([...loadHiddenIds()]).toEqual(["x", "y"]);

    saveHiddenIds(new Set());
    expect(window.localStorage.getItem(HIDDEN_GROUPS_STORAGE_KEY)).toBeNull();
  });

  it("keeps hidden places under a separate key from hidden groups", () => {
    saveHiddenIds(new Set(["g"]));
    saveHiddenPlaceIds(new Set(["p2", "p1"]));
    expect(window.localStorage.getItem(HIDDEN_GROUPS_STORAGE_KEY)).toBe(
      '["g"]',
    );
    expect(window.localStorage.getItem(HIDDEN_PLACES_STORAGE_KEY)).toBe(
      '["p1","p2"]',
    );
    expect([...loadHiddenPlaceIds()]).toEqual(["p1", "p2"]);
    expect([...loadHiddenIds()]).toEqual(["g"]);

    saveHiddenPlaceIds(new Set());
    expect(window.localStorage.getItem(HIDDEN_PLACES_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(HIDDEN_GROUPS_STORAGE_KEY)).toBe(
      '["g"]',
    );
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(loadHiddenIds().size).toBe(0);
    expect(loadHiddenPlaceIds().size).toBe(0);
    expect(() => saveHiddenIds(new Set(["x"]))).not.toThrow();
    expect(() => saveHiddenPlaceIds(new Set(["x"]))).not.toThrow();
    expect(() => saveHiddenIds(new Set())).not.toThrow();
  });
});

describe("only-selected option storage", () => {
  it("round-trips and clears the stored flag", () => {
    expect(loadOnlySelected()).toBe(false);
    saveOnlySelected(true);
    expect(window.localStorage.getItem(ONLY_SELECTED_STORAGE_KEY)).toBe("1");
    expect(loadOnlySelected()).toBe(true);
    saveOnlySelected(false);
    expect(window.localStorage.getItem(ONLY_SELECTED_STORAGE_KEY)).toBeNull();
    expect(loadOnlySelected()).toBe(false);
  });

  it("treats unexpected stored values as off and survives blocked storage", () => {
    window.localStorage.setItem(ONLY_SELECTED_STORAGE_KEY, "true");
    expect(loadOnlySelected()).toBe(false);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(loadOnlySelected()).toBe(false);
    expect(() => saveOnlySelected(true)).not.toThrow();
    expect(() => saveOnlySelected(false)).not.toThrow();
  });
});
