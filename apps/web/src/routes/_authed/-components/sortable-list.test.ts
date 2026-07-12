import { describe, expect, it } from "vitest";
import { reorderIds } from "./sortable-list";

describe("reorderIds", () => {
  it("moves the active id to the over position", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
  it("returns the same array when ids are unknown or equal", () => {
    const ids = ["a", "b"];
    expect(reorderIds(ids, "x", "a")).toBe(ids);
    expect(reorderIds(ids, "a", "a")).toBe(ids);
  });
});
