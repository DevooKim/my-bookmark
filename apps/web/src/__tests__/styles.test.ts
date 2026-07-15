import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("global interaction styles", () => {
  it("raises a virtual bookmark row while its menu is expanded", () => {
    const styles = readFileSync(
      path.resolve(__dirname, "../styles.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.virtual-bookmark-row:has\(\[aria-expanded="true"\]\)\s*\{[^}]*z-index:\s*20;/,
    );
  });
});
