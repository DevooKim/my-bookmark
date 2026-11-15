import { z } from "zod";

// 지도에서 숨긴 게시물(북마크)·장소 id 목록. 기기별 편의 설정이라 서버가 아닌 localStorage에만 둔다.
// 장소는 그룹 숨김과 별도 키(기존 저장값과 하위 호환)에 장소 id 배열로 저장한다.
export const HIDDEN_GROUPS_STORAGE_KEY = "my-bookmark:map-hidden-groups";
export const HIDDEN_PLACES_STORAGE_KEY = "my-bookmark:map-hidden-places";

const hiddenIdsSchema = z.array(z.string().min(1).max(64));

export function serializeHiddenIds(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

// 저장값이 없거나 깨졌으면 빈 집합이다(아무것도 숨기지 않는다).
export function parseHiddenIds(raw: string | null): Set<string> {
  if (!raw) {
    return new Set();
  }
  try {
    const parsed = hiddenIdsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? new Set(parsed.data) : new Set();
  } catch {
    return new Set();
  }
}

// 저장소가 막혀 있어도(시크릿 모드, 사이트 데이터 차단 등) 예외를 밖으로 내지 않는다.
function load(key: string): Set<string> {
  try {
    return parseHiddenIds(window.localStorage.getItem(key));
  } catch {
    return new Set();
  }
}

function save(key: string, ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, serializeHiddenIds(ids));
    }
  } catch {
    // 저장 실패는 이번 세션 동안만 숨김이 유지된다는 뜻일 뿐이다.
  }
}

export function loadHiddenIds(): Set<string> {
  return load(HIDDEN_GROUPS_STORAGE_KEY);
}

export function saveHiddenIds(ids: ReadonlySet<string>): void {
  save(HIDDEN_GROUPS_STORAGE_KEY, ids);
}

export function loadHiddenPlaceIds(): Set<string> {
  return load(HIDDEN_PLACES_STORAGE_KEY);
}

export function saveHiddenPlaceIds(ids: ReadonlySet<string>): void {
  save(HIDDEN_PLACES_STORAGE_KEY, ids);
}

// '선택한 게시물만 보기' 옵션. 기기별 편의 설정이라 localStorage에만 둔다.
export const ONLY_SELECTED_STORAGE_KEY = "my-bookmark:map-only-selected";

export function loadOnlySelected(): boolean {
  try {
    return window.localStorage.getItem(ONLY_SELECTED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveOnlySelected(value: boolean): void {
  try {
    if (value) {
      window.localStorage.setItem(ONLY_SELECTED_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(ONLY_SELECTED_STORAGE_KEY);
    }
  } catch {
    // 저장 실패는 이번 세션 동안만 옵션이 유지된다는 뜻일 뿐이다.
  }
}
