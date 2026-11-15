import { uuidSchema } from "@my-bookmark/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { listPlaceGroups } from "../../lib/api-client";
import { browserNaverMapEnv, openNaverMap } from "../../lib/naver-map-link";
import { createNaverMapAdapterFactory } from "../../lib/naver-maps";
import { PlaceMapScreen } from "./-components/place-map-screen";

const mapSearchSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  bookmark: uuidSchema.optional().catch(undefined),
});

// 빌드 시점에 번들에 포함되는 값이다. 없으면 지도 대신 안내 문구를 보여 준다.
const naverMapClientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
const createAdapter = naverMapClientId
  ? createNaverMapAdapterFactory(naverMapClientId)
  : null;

export const Route = createFileRoute("/_authed/map")({
  validateSearch: (search) => mapSearchSchema.parse(search),
  component: MapPage,
});

function MapPage() {
  const { q, bookmark } = Route.useSearch();
  const navigate = useNavigate();
  const placesQuery = useQuery({
    queryKey: ["places"],
    queryFn: listPlaceGroups,
  });
  const handleQueryChange = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      void navigate({
        to: "/map",
        search: (previous) => ({
          ...previous,
          q: trimmed.length > 0 ? trimmed : undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <main>
      <PlaceMapScreen
        createAdapter={createAdapter}
        groups={placesQuery.data?.items ?? []}
        hasError={placesQuery.isError}
        initialBookmarkId={bookmark}
        isLoading={placesQuery.isPending}
        onOpenNaverMap={(place) => openNaverMap(place, browserNaverMapEnv())}
        onQueryChange={handleQueryChange}
        query={q ?? ""}
      />
    </main>
  );
}
