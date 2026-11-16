export function domainFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
