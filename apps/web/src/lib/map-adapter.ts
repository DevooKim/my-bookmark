// 지도 SDK를 화면 코드에서 분리하는 얇은 어댑터 계약. 테스트에서는 fake로 대체한다.
export type MarkerState = "normal" | "active" | "dim";

export interface MapMarkerView {
  id: string;
  groupId: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
  state: MarkerState;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapAdapterHandlers {
  onMarkerClick(markerId: string): void;
  onBackgroundClick(): void;
  // 인증 키·서비스 URL 문제로 SDK가 인증에 실패했을 때
  onAuthFailure(): void;
}

export interface MapAdapter {
  setMarkers(markers: readonly MapMarkerView[]): void;
  fitTo(points: readonly MapPoint[]): void;
  panTo(point: MapPoint): void;
  destroy(): void;
}

// SDK 로드에 실패하면 reject한다.
export type MapAdapterFactory = (
  container: HTMLElement,
  handlers: MapAdapterHandlers,
) => Promise<MapAdapter>;

// 같은 게시물의 마커는 같은 색이다. 색은 전체 목록 기준 순서로 고정해 검색 전후로
// 바뀌지 않는다.
export const GROUP_COLORS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
] as const;

export function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length] ?? GROUP_COLORS[0];
}
