export const OPEN_BOOKMARK_DIALOG_EVENT = "open-bookmark-dialog";
let hasPendingRequest = false;

export function requestBookmarkDialog(): void {
  hasPendingRequest = true;
  window.dispatchEvent(new Event(OPEN_BOOKMARK_DIALOG_EVENT));
}

export function consumeBookmarkDialogRequest(): boolean {
  if (!hasPendingRequest) {
    return false;
  }
  hasPendingRequest = false;
  return true;
}
