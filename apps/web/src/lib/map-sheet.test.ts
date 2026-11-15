import { describe, expect, it } from "vitest";
import {
  resolveSheetDrag,
  SHEET_DRAG_THRESHOLD_PX,
  sheetSummary,
} from "./map-sheet";

describe("sheetSummary", () => {
  it("shows the selected post title, otherwise the post count", () => {
    expect(sheetSummary({ selectedTitle: "서촌 카페", groupCount: 3 })).toBe(
      "서촌 카페",
    );
    expect(sheetSummary({ selectedTitle: null, groupCount: 3 })).toBe(
      "게시물 3개",
    );
    expect(sheetSummary({ selectedTitle: "  ", groupCount: 0 })).toBe(
      "게시물 0개",
    );
  });
});

describe("resolveSheetDrag", () => {
  it("expands on an upward drag and collapses on a downward drag", () => {
    expect(resolveSheetDrag("collapsed", -SHEET_DRAG_THRESHOLD_PX)).toBe(
      "expanded",
    );
    expect(resolveSheetDrag("expanded", SHEET_DRAG_THRESHOLD_PX)).toBe(
      "collapsed",
    );
    // 이미 그 상태면 그대로 둔다(되돌리지 않는다).
    expect(resolveSheetDrag("expanded", -80)).toBe("expanded");
    expect(resolveSheetDrag("collapsed", 80)).toBe("collapsed");
  });

  it("treats a small movement as a tap that toggles the sheet", () => {
    expect(resolveSheetDrag("collapsed", 0)).toBe("expanded");
    expect(resolveSheetDrag("expanded", 3)).toBe("collapsed");
    expect(resolveSheetDrag("collapsed", -(SHEET_DRAG_THRESHOLD_PX - 1))).toBe(
      "expanded",
    );
  });
});
