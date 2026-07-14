import type { SourceCandidate, SourcePlatform } from "@my-bookmark/ai";
import { describe, expect, it } from "vitest";
import { buildSourceMetadataEntry } from "../services/source-link";

function candidate(
  platform: SourcePlatform,
  overrides: Partial<SourceCandidate> = {},
): SourceCandidate {
  return {
    platform,
    handle: "account",
    postUrl: null,
    repository: null,
    confidence: 0.85,
    ...overrides,
  };
}

describe("buildSourceMetadataEntry", () => {
  it("builds profile links for every supported platform", () => {
    expect(buildSourceMetadataEntry(candidate("youtube"))).toEqual({
      key: "유튜브",
      value: "https://www.youtube.com/@account",
    });
    expect(buildSourceMetadataEntry(candidate("instagram"))).toEqual({
      key: "인스타그램",
      value: "https://www.instagram.com/account/",
    });
    expect(buildSourceMetadataEntry(candidate("threads"))).toEqual({
      key: "스레드",
      value: "https://www.threads.net/@account",
    });
    expect(buildSourceMetadataEntry(candidate("x"))).toEqual({
      key: "X",
      value: "https://x.com/account",
    });
    expect(buildSourceMetadataEntry(candidate("tiktok"))).toEqual({
      key: "틱톡",
      value: "https://www.tiktok.com/@account",
    });
    expect(buildSourceMetadataEntry(candidate("github"))).toEqual({
      key: "GitHub",
      value: "https://github.com/account",
    });
  });

  it("accepts the confidence boundary and rejects values below it", () => {
    expect(
      buildSourceMetadataEntry(candidate("x", { confidence: 0.85 })),
    ).not.toBeNull();
    expect(
      buildSourceMetadataEntry(candidate("x", { confidence: 0.849 })),
    ).toBeNull();
  });

  it("prefers a directly evidenced HTTPS post URL", () => {
    expect(
      buildSourceMetadataEntry(
        candidate("instagram", {
          handle: "fallback",
          postUrl: "https://www.instagram.com/p/ABC123/",
        }),
      ),
    ).toEqual({
      key: "인스타그램",
      value: "https://www.instagram.com/p/ABC123/",
    });
    expect(
      buildSourceMetadataEntry(
        candidate("youtube", {
          handle: null,
          postUrl: "https://youtu.be/abc123",
        }),
      ),
    ).toEqual({ key: "유튜브", value: "https://youtu.be/abc123" });
  });

  it("rejects insecure, root, credentialed, and lookalike post URLs", () => {
    for (const postUrl of [
      "http://github.com/owner/repo",
      "https://github.com/",
      "https://user:secret@github.com/owner/repo",
      "https://github.com.evil.test/owner/repo",
    ]) {
      expect(
        buildSourceMetadataEntry(
          candidate("github", { handle: null, postUrl }),
        ),
      ).toBeNull();
    }
  });

  it("uses a GitHub repository before the profile fallback", () => {
    expect(
      buildSourceMetadataEntry(
        candidate("github", {
          handle: "fallback-user",
          repository: "DevooKim/my-bookmark",
        }),
      ),
    ).toEqual({
      key: "GitHub",
      value: "https://github.com/DevooKim/my-bookmark",
    });
  });

  it("normalizes a leading at sign and rejects invalid handles or repositories", () => {
    expect(
      buildSourceMetadataEntry(candidate("instagram", { handle: "@account" })),
    ).toEqual({
      key: "인스타그램",
      value: "https://www.instagram.com/account/",
    });
    expect(
      buildSourceMetadataEntry(candidate("x", { handle: "bad handle" })),
    ).toBeNull();
    expect(
      buildSourceMetadataEntry(candidate("tiktok", { handle: "bad/path" })),
    ).toBeNull();
    expect(
      buildSourceMetadataEntry(
        candidate("github", {
          handle: null,
          repository: "owner/repo/extra",
        }),
      ),
    ).toBeNull();
  });

  it("returns null without a usable candidate", () => {
    expect(buildSourceMetadataEntry(null)).toBeNull();
    expect(buildSourceMetadataEntry(undefined)).toBeNull();
    expect(
      buildSourceMetadataEntry(
        candidate("youtube", {
          handle: null,
          postUrl: null,
          repository: null,
        }),
      ),
    ).toBeNull();
  });
});
