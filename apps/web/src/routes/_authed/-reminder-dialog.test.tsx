import type { Bookmark } from "@my-bookmark/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReminder, rescheduleReminder } from "../../lib/api-client";
import { ReminderDialog } from "./-components/bookmark-dialogs";

vi.mock("../../lib/api-client", () => ({
  ApiClientError: class ApiClientError extends Error {
    status = 500;
  },
  createBookmark: vi.fn(),
  createCategory: vi.fn(),
  createReminder: vi.fn(),
  rescheduleReminder: vi.fn(),
  updateBookmark: vi.fn(),
}));

const bookmark: Bookmark = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  kind: "link",
  url: "https://example.com",
  image: null,
  title: "Example",
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: [],
  metadata: {},
  aiStatus: "done",
  aiModel: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof ReminderDialog>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReminderDialog bookmark={bookmark} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

function submitDialog(): void {
  const form = screen.getByRole("button", { name: "저장" }).closest("form");
  if (!form) {
    throw new Error("Reminder form is missing");
  }
  fireEvent.submit(form);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    locale: "ko-KR",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Asia/Seoul",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReminderDialog", () => {
  it("sends the selected recurrence and browser timezone", async () => {
    vi.mocked(createReminder).mockResolvedValue({} as never);
    renderDialog();

    fireEvent.change(screen.getByLabelText("반복"), {
      target: { value: "weekly" },
    });
    submitDialog();

    await waitFor(() =>
      expect(createReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          bookmarkId: bookmark.id,
          recurrence: "weekly",
          recurrenceTimezone: "Asia/Seoul",
        }),
      ),
    );
  });

  it("prefills the note and reuses a sent reminder row", async () => {
    vi.mocked(rescheduleReminder).mockResolvedValue({} as never);
    renderDialog({
      reminder: {
        id: "33333333-3333-4333-8333-333333333333",
        note: "기존 메모",
        recurrence: "none",
      },
    });

    expect(
      (screen.getByLabelText("메모(선택)") as HTMLTextAreaElement).value,
    ).toBe("기존 메모");
    submitDialog();

    await waitFor(() =>
      expect(rescheduleReminder).toHaveBeenCalledWith(
        "33333333-3333-4333-8333-333333333333",
        expect.objectContaining({
          note: "기존 메모",
          recurrence: "none",
          recurrenceTimezone: "Asia/Seoul",
        }),
      ),
    );
  });
});
