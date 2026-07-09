import { describe, expect, it, vi } from "vitest";
import { processDueReminders } from "../services/reminder-cron";

const reminder = {
  id: "reminder-1",
  user_id: "user-1",
  bookmark_id: "bookmark-1",
  remind_at: "2026-07-10T12:00:00.000Z",
  note: "Read this later",
  bookmark: {
    url: "https://example.com/article",
    title: "Example article",
  },
};

function createDb({ claimed = true } = {}) {
  return {
    dueReminders: vi.fn().mockResolvedValue([reminder]),
    claimReminder: vi.fn().mockResolvedValue(claimed),
    subscriptionsForUser: vi.fn().mockResolvedValue([
      {
        id: "sub-1",
        endpoint: "https://push.example/sub-1",
        keys: { p256dh: "p256dh", auth: "auth" },
      },
    ]),
  };
}

describe("reminder cron", () => {
  it("claims pending due reminders before sending", async () => {
    const db = createDb();
    const pushSender = { send: vi.fn().mockResolvedValue({ ok: true }) };

    const result = await processDueReminders({
      db,
      pushSender,
      now: new Date("2026-07-10T12:01:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, claimed: 1, sent: 1, failed: 0 });
    expect(db.claimReminder).toHaveBeenCalledWith("reminder-1");
    expect(pushSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-1" }),
      {
        title: "🔖 Example article",
        body: "Read this later",
        url: "https://example.com/article",
      },
    );
  });

  it("does not send when a competing worker already claimed the reminder", async () => {
    const db = createDb({ claimed: false });
    const pushSender = { send: vi.fn() };

    const result = await processDueReminders({
      db,
      pushSender,
      now: new Date("2026-07-10T12:01:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, claimed: 0, sent: 0, failed: 0 });
    expect(pushSender.send).not.toHaveBeenCalled();
  });
});
