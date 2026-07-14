import { describe, expect, it, vi } from "vitest";
import {
  loginUrlForLocation,
  navigateToLogin,
  parsePostLoginRedirect,
} from "./auth-redirect";

describe("authentication redirects", () => {
  it("preserves an image share batch through login", () => {
    expect(
      loginUrlForLocation({ pathname: "/share-target", search: "?id=batch" }),
    ).toBe("/login?redirect=%2Fshare-target%3Fid%3Dbatch");
    expect(parsePostLoginRedirect("/share-target?id=batch")).toBe(
      "/share-target?id=batch",
    );
  });

  it("rejects external and malformed post-login redirects", () => {
    expect(parsePostLoginRedirect("https://evil.example")).toBe("/");
    expect(parsePostLoginRedirect("//evil.example/path")).toBe("/");
    expect(parsePostLoginRedirect("/\\evil.example/path")).toBe("/");
    expect(parsePostLoginRedirect("/safe\npath")).toBe("/");
    expect(parsePostLoginRedirect(null)).toBe("/");
  });

  it("navigates to login while preserving the current protected location", () => {
    const assign = vi.fn();

    navigateToLogin(
      { pathname: "/images/id", search: "?view=preview" },
      assign,
    );

    expect(assign).toHaveBeenCalledWith(
      "/login?redirect=%2Fimages%2Fid%3Fview%3Dpreview",
    );
  });
});
