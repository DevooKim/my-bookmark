import { describe, expect, it } from "vitest";
import { extractMetadataFromHtml, isPrivateHost } from "../services/metadata";

describe("metadata", () => {
  it("extracts open graph metadata and resolves relative URLs", () => {
    const metadata = extractMetadataFromHtml(
      `<!doctype html>
      <html><head>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG Description" />
        <meta property="og:site_name" content="Example" />
        <meta property="og:image" content="/image.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <title>Fallback Title</title>
      </head></html>`,
      "https://example.com/posts/1",
    );

    expect(metadata).toEqual({
      title: "OG Title",
      description: "OG Description",
      siteName: "Example",
      ogImageUrl: "https://example.com/image.png",
      faviconUrl: "https://example.com/favicon.ico",
    });
  });

  it("identifies private and loopback hosts for SSRF protection", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.0.10")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("172.20.0.1")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});
