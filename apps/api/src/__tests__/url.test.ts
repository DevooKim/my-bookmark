import { describe, expect, it } from "vitest";
import { normalizeBookmarkUrl } from "../lib/url";

describe("normalizeBookmarkUrl", () => {
  it("trims, removes fragments, and drops tracking parameters", () => {
    expect(
      normalizeBookmarkUrl(
        " https://example.com/post?utm_source=newsletter&x=1&fbclid=abc#section ",
      ),
    ).toBe("https://example.com/post?x=1");
  });

  it("rejects non-http urls", () => {
    expect(() => normalizeBookmarkUrl("file:///etc/passwd")).toThrow(
      /http or https/,
    );
  });
});
