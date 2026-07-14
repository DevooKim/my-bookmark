interface LocationParts {
  pathname: string;
  search: string;
}

export function loginUrlForLocation(location: LocationParts): string {
  const redirect = `${location.pathname}${location.search}`;
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

export function navigateToLogin(
  location: LocationParts = window.location,
  assign: (url: string) => void = (url) => window.location.assign(url),
): void {
  assign(loginUrlForLocation(location));
}

export function parsePostLoginRedirect(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    return "/";
  }
  try {
    const base = new URL("https://my-bookmark.invalid");
    const resolved = new URL(value, base);
    return resolved.origin === base.origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : "/";
  } catch {
    return "/";
  }
}
