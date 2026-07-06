import { API_ERROR_CODES } from "@my-bookmark/shared";
import { HttpError } from "../middleware/error";

const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

export function normalizeBookmarkUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "url must be a valid URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      "url must use http or https",
    );
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

export function domainFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
