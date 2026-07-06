import { lookup } from "node:dns/promises";
import * as cheerio from "cheerio";
import { domainFromUrl } from "../lib/url";

export interface PageMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
}

const EMPTY_METADATA: PageMetadata = {
  title: null,
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
};

export function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const parts = normalized.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

export async function isPrivateFetchTarget(
  host: string,
  resolveAddresses: (host: string) => Promise<string[]> = async (target) => {
    const records = await lookup(target, { all: true });
    return records.map((record) => record.address);
  },
): Promise<boolean> {
  if (isPrivateHost(host)) {
    return true;
  }
  const addresses = await resolveAddresses(host);
  return addresses.some(isPrivateHost);
}

export function extractMetadataFromHtml(
  html: string,
  pageUrl: string,
): PageMetadata {
  const $ = cheerio.load(html);
  const attr = (selector: string, name: string) =>
    $(selector).first().attr(name)?.trim() || null;
  const content = (selector: string) => attr(selector, "content");
  const text = (selector: string) => $(selector).first().text().trim() || null;
  const absolute = (value: string | null) => {
    if (!value) {
      return null;
    }
    try {
      return new URL(value, pageUrl).toString();
    } catch {
      return null;
    }
  };

  return {
    title: content('meta[property="og:title"]') ?? text("title"),
    description:
      content('meta[property="og:description"]') ??
      content('meta[name="description"]'),
    siteName: content('meta[property="og:site_name"]'),
    faviconUrl: absolute(attr('link[rel~="icon"]', "href")),
    ogImageUrl: absolute(content('meta[property="og:image"]')),
  };
}

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  const parsed = new URL(url);
  if (await isPrivateFetchTarget(parsed.hostname)) {
    return fallbackMetadata(url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchWithRedirects(url, controller.signal, 3);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return fallbackMetadata(url);
    }

    const html = await readLimitedText(response, 1024 * 1024);
    const metadata = extractMetadataFromHtml(html, response.url || url);
    return withFallbacks(metadata, url);
  } catch {
    return fallbackMetadata(url);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRedirects(
  url: string,
  signal: AbortSignal,
  redirectsLeft: number,
): Promise<Response> {
  const response = await fetch(url, {
    headers: { "User-Agent": "MyBookmarkBot/1.0" },
    redirect: "manual",
    signal,
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has("location") &&
    redirectsLeft > 0
  ) {
    const nextUrl = new URL(response.headers.get("location") ?? "", url);
    if (await isPrivateFetchTarget(nextUrl.hostname)) {
      throw new Error("Blocked private redirect target");
    }
    return fetchWithRedirects(nextUrl.toString(), signal, redirectsLeft - 1);
  }

  return response;
}

async function readLimitedText(
  response: Response,
  limit: number,
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Metadata response exceeds 1MB");
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function withFallbacks(metadata: PageMetadata, url: string): PageMetadata {
  const host = domainFromUrl(url);
  return {
    ...metadata,
    title: metadata.title ?? host,
    faviconUrl:
      metadata.faviconUrl ??
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  };
}

function fallbackMetadata(url: string): PageMetadata {
  return withFallbacks(EMPTY_METADATA, url);
}
