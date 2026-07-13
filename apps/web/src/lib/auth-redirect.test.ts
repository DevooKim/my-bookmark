import { describe, expect, it } from "vitest";
import { loginUrlForLocation, parsePostLoginRedirect } from "./auth-redirect";

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
});
