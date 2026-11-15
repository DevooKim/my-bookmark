// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_GROUPS_STORAGE_KEY,
  loadHiddenIds,
  parseHiddenIds,
  saveHiddenIds,
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
    expect(() => saveHiddenIds(new Set(["x"]))).not.toThrow();
    expect(() => saveHiddenIds(new Set())).not.toThrow();
  });
});
