import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("liquid glass overlay styles", () => {
  it("blurs and saturates a translucent, bordered, highlighted surface from the design tokens", () => {
    const glass = block(".glass-surface");
    expect(glass).toMatch(/background: var\(--glass-bg\)/);
    expect(glass).toMatch(
      /backdrop-filter: blur\(2[0-4]px\) saturate\((1[6-8]\d)%\)/,
    );
    expect(glass).toMatch(/-webkit-backdrop-filter: blur/);
    expect(glass).toMatch(/border: 1px solid var\(--glass-edge\)/);
    expect(glass).toMatch(/inset 0 1px 0 var\(--glass-highlight\)/);
    expect(css).toMatch(
      /--glass-bg: color-mix\(in srgb, var\(--surface-solid\)/,
    );
  });

  it("falls back to a near-opaque background without backdrop-filter and when transparency is reduced", () => {
    // 포매터가 줄바꿈을 바꿔도 통과하도록 공백을 접어서 비교한다.
    const flat = css.replace(/\s+/g, " ");
    expect(flat).toMatch(
      /@supports not \( ?\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\) ?\) \{ \.glass-surface \{ background: var\(--glass-opaque\)/,
    );
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-transparency: reduce)"),
    );
    expect(reduced).toMatch(/\.glass-surface/);
    expect(reduced).toMatch(/background: var\(--surface-solid\)/);
    expect(reduced).toMatch(/backdrop-filter: none/);
  });

  it("defines light and dark text colors for contrast on the glass", () => {
    expect(css).toMatch(/--glass-secondary: #424245/);
    expect(css).toMatch(/:root\.dark \{[\s\S]*--glass-secondary: #e1e1e6/);
  });

  it("switches the bottom sheet without animation for reduced motion", () => {
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toMatch(/\.map-sheet,[\s\S]*transition: none/);
  });
});
