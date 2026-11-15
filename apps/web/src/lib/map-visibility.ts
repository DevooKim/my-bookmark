import { z } from "zod";

// 지도에서 숨긴 게시물(북마크) id 목록. 기기별 편의 설정이라 서버가 아닌 localStorage에만 둔다.
export const HIDDEN_GROUPS_STORAGE_KEY = "my-bookmark:map-hidden-groups";

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
export function loadHiddenIds(): Set<string> {
  try {
    return parseHiddenIds(
      window.localStorage.getItem(HIDDEN_GROUPS_STORAGE_KEY),
    );
  } catch {
    return new Set();
  }
}

export function saveHiddenIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) {
      window.localStorage.removeItem(HIDDEN_GROUPS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        HIDDEN_GROUPS_STORAGE_KEY,
        serializeHiddenIds(ids),
      );
    }
  } catch {
    // 저장 실패는 이번 세션 동안만 숨김이 유지된다는 뜻일 뿐이다.
  }
}
