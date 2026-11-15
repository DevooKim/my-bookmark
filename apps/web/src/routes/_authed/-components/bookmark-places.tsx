import type { BookmarkPlace } from "@my-bookmark/shared";
import { MapPin } from "lucide-react";
import { useState } from "react";

export const COLLAPSED_PLACE_COUNT = 3;

const chipBase =
  "inline-flex max-w-full items-center gap-1 truncate rounded-lg px-2 py-1 font-medium";
// 2026-07-15 결정에 따라 URL 메타데이터 뱃지와 같은 파란 hover를 쓴다.
// 네이버/구글 구분은 링크 대상(mapUrl)이 하며 색으로 나누지 않는다.
const chip = `${chipBase} bg-blue-50 text-blue-700 hover:bg-blue-700 hover:text-white dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-600 dark:hover:text-white`;

export function BookmarkPlaces({
  places,
  collapsible = false,
  interactive = false,
}: {
  places: BookmarkPlace[];
  collapsible?: boolean;
  interactive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (places.length === 0) {
    return null;
  }
  const visibleCount =
    collapsible && !expanded ? COLLAPSED_PLACE_COUNT : places.length;
  const visible = places.slice(0, visibleCount);
  const hiddenCount = places.length - visible.length;
  const layer = interactive ? " pointer-events-auto relative z-20" : "";

  return (
    <ul
      aria-label="장소"
      className={`mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs${layer}`}
    >
      {visible.map((place) => (
        <li className="min-w-0 max-w-full" key={place.id}>
          <a
            className={`${chip}${layer}`}
            href={place.mapUrl}
            rel="noreferrer"
            target="_blank"
          >
            <MapPin aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="truncate">{place.name}</span>
          </a>
        </li>
      ))}
      {hiddenCount > 0 ? (
        <li>
          <button
            aria-label={`장소 ${hiddenCount}개 더 보기`}
            className={`inline-flex items-center rounded-lg bg-zinc-100 px-2 py-1 font-medium text-zinc-600 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100${layer}`}
            onClick={() => setExpanded(true)}
            type="button"
          >
            +{hiddenCount}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
