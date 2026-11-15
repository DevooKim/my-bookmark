import { appEnv } from "../lib/env";
import { createPlaceGeocoder, type PlaceGeocoder } from "./place-geocoder";

const geocoder: PlaceGeocoder | null =
  appEnv.NAVER_SEARCH_CLIENT_ID && appEnv.NAVER_SEARCH_CLIENT_SECRET
    ? createPlaceGeocoder({
        clientId: appEnv.NAVER_SEARCH_CLIENT_ID,
        clientSecret: appEnv.NAVER_SEARCH_CLIENT_SECRET,
      })
    : null;

if (!geocoder) {
  console.warn(
    "NAVER_SEARCH_CLIENT_ID/NAVER_SEARCH_CLIENT_SECRET is not set — place geocoding is disabled",
  );
}

export function getPlaceGeocoder(): PlaceGeocoder | null {
  return geocoder;
}
