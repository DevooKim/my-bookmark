export type PlaceMapProvider = "naver" | "google";

export interface PlaceMapLinkInput {
  name: string;
  locality: string | null;
  countryCode: string | null;
}

// country_code가 KR이거나 알 수 없으면(null) 국내 장소로 취급한다.
export function isDomesticPlace(place: {
  countryCode: string | null;
}): boolean {
  return place.countryCode === null || place.countryCode === "KR";
}

export function buildPlaceMapLink(place: PlaceMapLinkInput): {
  provider: PlaceMapProvider;
  url: string;
} {
  const query = encodeURIComponent(
    [place.name, place.locality]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(" "),
  );
  if (isDomesticPlace(place)) {
    return {
      provider: "naver",
      url: `https://map.naver.com/p/search/${query}`,
    };
  }
  return {
    provider: "google",
    url: `https://www.google.com/maps/search/?api=1&query=${query}`,
  };
}
