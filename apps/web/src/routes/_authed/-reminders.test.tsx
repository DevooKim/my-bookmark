import type { ReminderWithBookmark } from "@my-bookmark/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelReminder,
  getPushStatus,
  listReminders,
  updateReminder,
} from "../../lib/api-client";
import { RemindersPage } from "./reminders";

vi.mock("../../lib/api-client", () => ({
  cancelReminder: vi.fn(),
  getPushStatus: vi.fn(),
  listReminders: vi.fn(),
  rescheduleReminder: vi.fn(),
  updateReminder: vi.fn(),
}));

const baseReminder: ReminderWithBookmark = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  bookmarkId: "33333333-3333-4333-8333-333333333333",
  remindAt: "2026-07-14T09:00:00.000Z",
  note: null,
  status: "sent",
  sentAt: "2026-07-14T09:00:00.000Z",
  recurrence: "none",
  recurrenceTimezone: "Asia/Seoul",
  isEnabled: true,
  createdAt: "2026-07-13T09:00:00.000Z",
  bookmark: {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "link",
    url: "https://example.com",
    title: "지난 링크",
  },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RemindersPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
  vi.mocked(getPushStatus).mockResolvedValue({
    enabled: true,
    subscriptionCount: 1,
    vapidPublicKey: "test-key",
  });
  vi.mocked(listReminders).mockResolvedValue({
    items: [
      baseReminder,
      {
        ...baseReminder,
        id: "44444444-4444-4444-8444-444444444444",
        remindAt: "2026-07-14T10:00:00.000Z",
        status: "pending",
        recurrence: "daily",
        isEnabled: false,
        bookmark: { ...baseReminder.bookmark, title: "반복 링크" },
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RemindersPage", () => {
  it("marks past reminders red and offers rescheduling", async () => {
    renderPage();
    const title = await screen.findByRole("link", { name: "지난 링크" });
    const article = title.closest("article");
    expect(article?.querySelector("[data-reminder-date]")?.className).toContain(
      "text-red-600",
    );
    expect(
      screen.getByRole("button", { name: "지난 링크 다시 알림" }),
    ).toBeTruthy();
  });

  it("shows recurrence state and can re-enable it", async () => {
    vi.mocked(updateReminder).mockResolvedValue({} as never);
    renderPage();

    expect(await screen.findByText("매일")).toBeTruthy();
    expect(screen.getByText("비활성")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "반복 링크 리마인더 활성화" }),
    );

    await waitFor(() =>
      expect(updateReminder).toHaveBeenCalledWith(
        "44444444-4444-4444-8444-444444444444",
        { isEnabled: true },
      ),
    );
  });

  it("allows a sent reminder to be removed manually", async () => {
    vi.mocked(cancelReminder).mockResolvedValue();
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "지난 링크 리마인더 삭제" }),
    );

    await waitFor(() =>
      expect(cancelReminder).toHaveBeenCalledWith(baseReminder.id),
    );
  });
});
