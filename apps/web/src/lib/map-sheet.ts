// 모바일 하단 시트의 상태와 제스처 판정. 화면 코드에서 분리한 순수 로직이다.
export type SheetState = "collapsed" | "expanded";

// 손잡이를 이만큼(px) 이상 움직이면 탭이 아니라 드래그로 본다.
export const SHEET_DRAG_THRESHOLD_PX = 24;

// 접힌 시트는 손잡이와 한 줄 요약만 보인다. 선택된 게시물이 있으면 그 제목, 없으면 게시물 수.
export function sheetSummary(input: {
  selectedTitle: string | null;
  groupCount: number;
}): string {
  const title = input.selectedTitle?.trim();
  return title ? title : `게시물 ${input.groupCount}개`;
}

// 손잡이 드래그가 끝났을 때의 다음 상태. dy는 (끝 y - 시작 y)이고 위로 끌면 음수다.
// 문턱 미만의 움직임은 탭으로 보고 상태를 뒤집는다.
export function resolveSheetDrag(current: SheetState, dy: number): SheetState {
  if (dy <= -SHEET_DRAG_THRESHOLD_PX) {
    return "expanded";
  }
  if (dy >= SHEET_DRAG_THRESHOLD_PX) {
    return "collapsed";
  }
  return current === "expanded" ? "collapsed" : "expanded";
}
