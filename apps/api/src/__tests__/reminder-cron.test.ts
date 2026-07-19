import { describe, expect, it, vi } from "vitest";
import {
  processDueReminders,
  startReminderCron,
} from "../services/reminder-cron";

const reminder = {
  id: "reminder-1",
  user_id: "user-1",
  bookmark_id: "bookmark-1",
  remind_at: "2026-07-10T12:00:00.000Z",
  note: "Read this later",
  recurrence: "none" as const,
  recurrence_timezone: "Asia/Seoul",
  recurrence_day: null,
  bookmark: {
    id: "bookmark-1",
    kind: "link" as const,
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
  it("does not schedule or claim reminders when push is not configured", () => {
    const schedule = vi.fn();

    const task = startReminderCron({ pushConfigured: false, schedule });

    expect(task).toBeNull();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("claims pending due reminders before sending", async () => {
    const db = createDb();
    const pushSender = { send: vi.fn().mockResolvedValue({ ok: true }) };

    const result = await processDueReminders({
      db,
      pushSender,
      now: new Date("2026-07-10T12:01:00.000Z"),
    });

    expect(result).toEqual({
      scanned: 1,
      claimed: 1,
      sent: 1,
      failed: 0,
      expired: 0,
    });
    expect(db.claimReminder).toHaveBeenCalledWith({
      id: "reminder-1",
      expectedRemindAt: "2026-07-10T12:00:00.000Z",
      claimedAt: "2026-07-10T12:01:00.000Z",
      nextRemindAt: null,
    });
    expect(pushSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub-1" }),
      {
        title: "🔖 Example article",
        body: "Read this later",
        url: "https://example.com/article",
      },
    );
  });

  it("advances a recurring reminder to its next future occurrence", async () => {
    const db = createDb();
    db.dueReminders.mockResolvedValue([
      {
        ...reminder,
        recurrence: "daily",
      },
    ]);
    const pushSender = { send: vi.fn().mockResolvedValue({ ok: true }) };

    await processDueReminders({
      db,
      pushSender,
      now: new Date("2026-07-15T12:01:00.000Z"),
    });

    expect(db.claimReminder).toHaveBeenCalledWith({
      id: "reminder-1",
      expectedRemindAt: "2026-07-10T12:00:00.000Z",
      claimedAt: "2026-07-15T12:01:00.000Z",
      nextRemindAt: "2026-07-16T12:00:00.000Z",
    });
    expect(pushSender.send).toHaveBeenCalledOnce();
  });

  it("does not send when a competing worker already claimed the reminder", async () => {
    const db = createDb({ claimed: false });
    const pushSender = { send: vi.fn() };

    const result = await processDueReminders({
      db,
      pushSender,
      now: new Date("2026-07-10T12:01:00.000Z"),
    });

    expect(result).toEqual({
      scanned: 1,
      claimed: 0,
      sent: 0,
      failed: 0,
      expired: 0,
    });
    expect(pushSender.send).not.toHaveBeenCalled();
  });

  it("opens an image reminder in the internal detail page", async () => {
    const db = createDb();
    db.dueReminders.mockResolvedValue([
      {
        ...reminder,
        note: null,
        bookmark: {
          id: "bookmark-1",
          kind: "image",
          url: null,
          title: "전시 포스터",
        },
      },
    ]);
    const pushSender = { send: vi.fn().mockResolvedValue({ ok: true }) };

    await processDueReminders({
      db,
      pushSender,
      webOrigin: "https://bookmark.example",
    });

    expect(pushSender.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "🔖 전시 포스터",
        body: "이미지",
        url: "https://bookmark.example/images/bookmark-1",
      }),
    );
  });

  it("counts expired subscriptions separately from delivery failures", async () => {
    const db = createDb();
    const pushSender = {
      send: vi.fn().mockResolvedValue({ ok: false, expired: true }),
    };

    const result = await processDueReminders({ db, pushSender });

    expect(result).toEqual({
      scanned: 1,
      claimed: 1,
      sent: 0,
      failed: 0,
      expired: 1,
    });
  });
});
