import { API_ERROR_CODES } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createRemindersRouter } from "../routes/reminders";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";
const otherBookmarkId = "33333333-3333-4333-8333-333333333333";
const reminderId = "44444444-4444-4444-8444-444444444444";
const sentReminderId = "55555555-5555-4555-8555-555555555555";
const cancelledReminderId = "66666666-6666-4666-8666-666666666666";
const recurringReminderId = "77777777-7777-4777-8777-777777777777";

interface ReminderRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_timezone: string;
  recurrence_day: number | null;
  is_enabled: boolean;
  created_at: string;
  bookmarks: {
    id: string;
    kind: "link" | "image";
    url: string | null;
    title: string | null;
  } | null;
}

class FakeRemindersDb {
  beforeUpdate: ((row: ReminderRow) => void) | null = null;
  bookmarks = new Map([[bookmarkId, userId]]);
  reminders: ReminderRow[] = [
    {
      id: reminderId,
      user_id: userId,
      bookmark_id: bookmarkId,
      remind_at: "2026-07-10T12:10:00.000Z",
      note: "old note",
      status: "pending",
      sent_at: null,
      recurrence: "none",
      recurrence_timezone: "Asia/Seoul",
      recurrence_day: null,
      is_enabled: true,
      created_at: "2026-07-10T12:00:00.000Z",
      bookmarks: {
        id: bookmarkId,
        kind: "link",
        url: "https://example.com",
        title: "Example",
      },
    },
    {
      id: sentReminderId,
      user_id: userId,
      bookmark_id: bookmarkId,
      remind_at: "2026-07-09T12:10:00.000Z",
      note: "sent note",
      status: "sent",
      sent_at: "2026-07-09T12:10:00.000Z",
      recurrence: "none",
      recurrence_timezone: "Asia/Seoul",
      recurrence_day: null,
      is_enabled: true,
      created_at: "2026-07-09T12:00:00.000Z",
      bookmarks: {
        id: bookmarkId,
        kind: "link",
        url: "https://example.com",
        title: "Example",
      },
    },
    {
      id: cancelledReminderId,
      user_id: userId,
      bookmark_id: bookmarkId,
      remind_at: "2026-07-08T12:10:00.000Z",
      note: null,
      status: "cancelled",
      sent_at: null,
      recurrence: "none",
      recurrence_timezone: "Asia/Seoul",
      recurrence_day: null,
      is_enabled: true,
      created_at: "2026-07-08T12:00:00.000Z",
      bookmarks: {
        id: bookmarkId,
        kind: "link",
        url: "https://example.com",
        title: "Example",
      },
    },
    {
      id: recurringReminderId,
      user_id: userId,
      bookmark_id: bookmarkId,
      remind_at: "2026-07-11T12:10:00.000Z",
      note: null,
      status: "pending",
      sent_at: "2026-07-10T12:10:00.000Z",
      recurrence: "daily",
      recurrence_timezone: "Asia/Seoul",
      recurrence_day: null,
      is_enabled: false,
      created_at: "2026-07-08T12:00:00.000Z",
      bookmarks: {
        id: bookmarkId,
        kind: "link",
        url: "https://example.com",
        title: "Example",
      },
    },
  ];

  listPending(userIdValue: string) {
    return Promise.resolve(
      this.reminders.filter(
        (reminder) =>
          reminder.user_id === userIdValue && reminder.status === "pending",
      ),
    );
  }

  listVisible(userIdValue: string) {
    return Promise.resolve(
      this.reminders.filter(
        (reminder) =>
          reminder.user_id === userIdValue && reminder.status !== "cancelled",
      ),
    );
  }

  getReminder(userIdValue: string, id: string) {
    return Promise.resolve(
      this.reminders.find(
        (reminder) =>
          reminder.user_id === userIdValue &&
          reminder.id === id &&
          reminder.status !== "cancelled",
      ) ?? null,
    );
  }

  bookmarkBelongsToUser(userIdValue: string, bookmarkIdValue: string) {
    return Promise.resolve(this.bookmarks.get(bookmarkIdValue) === userIdValue);
  }

  createReminder(input: {
    userId: string;
    bookmarkId: string;
    remindAt: string;
    note: string | null;
    recurrence?: ReminderRow["recurrence"];
    recurrenceTimezone?: string;
    recurrenceDay?: number | null;
  }) {
    const row: ReminderRow = {
      id: "55555555-5555-4555-8555-555555555555",
      user_id: input.userId,
      bookmark_id: input.bookmarkId,
      remind_at: input.remindAt,
      note: input.note,
      status: "pending",
      sent_at: null,
      recurrence: input.recurrence ?? "none",
      recurrence_timezone: input.recurrenceTimezone ?? "UTC",
      recurrence_day: input.recurrenceDay ?? null,
      is_enabled: true,
      created_at: "2026-07-10T12:00:00.000Z",
      bookmarks: {
        id: input.bookmarkId,
        kind: "link",
        url: "https://example.com",
        title: "Example",
      },
    };
    this.reminders.push(row);
    return Promise.resolve(row);
  }

  updatePendingReminder(input: {
    userId: string;
    id: string;
    remindAt: string;
    note: string | null;
    recurrence: ReminderRow["recurrence"];
    recurrenceTimezone: string;
    recurrenceDay: number | null;
    isEnabled: boolean;
    expectedRemindAt: string;
    expectedIsEnabled: boolean;
  }) {
    const row = this.reminders.find(
      (reminder) =>
        reminder.id === input.id &&
        reminder.user_id === input.userId &&
        reminder.status === "pending",
    );
    if (!row) {
      return Promise.resolve(null);
    }
    this.beforeUpdate?.(row);
    this.beforeUpdate = null;
    if (
      row.remind_at !== input.expectedRemindAt ||
      row.is_enabled !== input.expectedIsEnabled
    ) {
      return Promise.resolve(null);
    }
    row.remind_at = input.remindAt;
    row.note = input.note;
    row.recurrence = input.recurrence;
    row.recurrence_timezone = input.recurrenceTimezone;
    row.recurrence_day = input.recurrenceDay;
    row.is_enabled = input.isEnabled;
    return Promise.resolve(row);
  }

  cancelPendingReminder(userIdValue: string, id: string) {
    const row = this.reminders.find(
      (reminder) =>
        reminder.id === id &&
        reminder.user_id === userIdValue &&
        reminder.status === "pending",
    );
    if (row) {
      row.status = "cancelled";
    }
    return Promise.resolve();
  }

  cancelReminder(userIdValue: string, id: string) {
    const row = this.reminders.find(
      (reminder) =>
        reminder.id === id &&
        reminder.user_id === userIdValue &&
        reminder.status !== "cancelled",
    );
    if (row) {
      row.status = "cancelled";
    }
    return Promise.resolve();
  }

  rescheduleReminder(input: {
    userId: string;
    id: string;
    remindAt: string;
    note: string | null;
    recurrence: ReminderRow["recurrence"];
    recurrenceTimezone: string;
    recurrenceDay: number | null;
  }) {
    const row = this.reminders.find(
      (reminder) =>
        reminder.id === input.id &&
        reminder.user_id === input.userId &&
        reminder.status === "sent",
    );
    if (!row) {
      return Promise.resolve(null);
    }
    row.remind_at = input.remindAt;
    row.note = input.note;
    row.status = "pending";
    row.sent_at = null;
    row.recurrence = input.recurrence;
    row.recurrence_timezone = input.recurrenceTimezone;
    row.recurrence_day = input.recurrenceDay;
    row.is_enabled = true;
    return Promise.resolve(row);
  }
}

function createTestApp(db: FakeRemindersDb) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createRemindersRouter(
      () => db,
      requireAuth({ bearer: async () => userId }),
    ),
  );
  app.use(errorMiddleware);
  return app;
}

describe("reminders routes", () => {
  it("keeps sent and disabled reminders visible but excludes cancelled ones", async () => {
    const response = await request(createTestApp(new FakeRemindersDb()))
      .get("/api/reminders")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      reminderId,
      sentReminderId,
      recurringReminderId,
    ]);
  });

  it("rejects reminder creation when remindAt is not in the future", async () => {
    const app = createTestApp(new FakeRemindersDb());

    const response = await request(app)
      .post("/api/reminders")
      .set("Authorization", "Bearer test-token")
      .send({
        bookmarkId,
        remindAt: new Date(Date.now() - 1000).toISOString(),
        note: "too late",
        recurrence: "none",
        recurrenceTimezone: "Asia/Seoul",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  it("updates a pending reminder remindAt and note", async () => {
    const db = new FakeRemindersDb();
    const app = createTestApp(db);
    const nextRemindAt = new Date(Date.now() + 60_000).toISOString();

    const response = await request(app)
      .patch(`/api/reminders/${reminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({
        remindAt: nextRemindAt,
        note: "new note",
      });

    expect(response.status).toBe(200);
    expect(response.body.reminder.remindAt).toBe(nextRemindAt);
    expect(response.body.reminder.note).toBe("new note");
  });

  it("rejects reminder updates with past remindAt", async () => {
    const app = createTestApp(new FakeRemindersDb());

    const response = await request(app)
      .patch(`/api/reminders/${reminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({
        remindAt: new Date(Date.now() - 1000).toISOString(),
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
  });

  it("does not update sent reminders or reminders owned by another user", async () => {
    const db = new FakeRemindersDb();
    const existingReminder = db.reminders[0];
    if (!existingReminder) {
      throw new Error("test reminder missing");
    }
    existingReminder.status = "sent";
    const app = createTestApp(db);

    const sentResponse = await request(app)
      .patch(`/api/reminders/${reminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({ note: "should not update" });
    const missingResponse = await request(app)
      .post("/api/reminders")
      .set("Authorization", "Bearer test-token")
      .send({
        bookmarkId: otherBookmarkId,
        remindAt: new Date(Date.now() + 60_000).toISOString(),
        recurrence: "none",
        recurrenceTimezone: "Asia/Seoul",
      });

    expect(sentResponse.status).toBe(404);
    expect(missingResponse.status).toBe(400);
    expect(missingResponse.body.error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );
  });

  it("cancels a sent reminder so it is hidden from the list", async () => {
    const db = new FakeRemindersDb();
    const response = await request(createTestApp(db))
      .delete(`/api/reminders/${sentReminderId}`)
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(204);
    expect(
      db.reminders.find((reminder) => reminder.id === sentReminderId)?.status,
    ).toBe("cancelled");
  });

  it("disables and re-enables a recurring reminder", async () => {
    const db = new FakeRemindersDb();
    const app = createTestApp(db);
    const disabled = await request(app)
      .patch(`/api/reminders/${recurringReminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({ isEnabled: false });
    const enabled = await request(app)
      .patch(`/api/reminders/${recurringReminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({ isEnabled: true });

    expect(disabled.status).toBe(200);
    expect(disabled.body.reminder.isEnabled).toBe(false);
    expect(enabled.status).toBe(200);
    expect(enabled.body.reminder.isEnabled).toBe(true);
    expect(new Date(enabled.body.reminder.remindAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("reschedules a sent reminder using the same row", async () => {
    const nextRemindAt = new Date(Date.now() + 60_000).toISOString();
    const response = await request(createTestApp(new FakeRemindersDb()))
      .post(`/api/reminders/${sentReminderId}/reschedule`)
      .set("Authorization", "Bearer test-token")
      .send({
        remindAt: nextRemindAt,
        note: "again",
        recurrence: "monthly",
        recurrenceTimezone: "Asia/Seoul",
      });

    expect(response.status).toBe(200);
    expect(response.body.reminder).toMatchObject({
      id: sentReminderId,
      remindAt: nextRemindAt,
      note: "again",
      status: "pending",
      recurrence: "monthly",
      isEnabled: true,
    });
  });

  it("rejects a stale patch after cron advances the same recurring row", async () => {
    const db = new FakeRemindersDb();
    db.beforeUpdate = (row) => {
      row.remind_at = "2026-07-16T12:10:00.000Z";
    };
    const response = await request(createTestApp(db))
      .patch(`/api/reminders/${recurringReminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({ note: "stale update" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(API_ERROR_CODES.CONFLICT);
    expect(
      db.reminders.find((reminder) => reminder.id === recurringReminderId)
        ?.note,
    ).toBeNull();
  });

  it("does not turn a disabled recurring reminder into a disabled one-off", async () => {
    const db = new FakeRemindersDb();
    const response = await request(createTestApp(db))
      .patch(`/api/reminders/${recurringReminderId}`)
      .set("Authorization", "Bearer test-token")
      .send({ recurrence: "none" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(
      db.reminders.find((reminder) => reminder.id === recurringReminderId)
        ?.recurrence,
    ).toBe("daily");
  });

  it("recomputes a monthly anchor before enabling in a new timezone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    try {
      const db = new FakeRemindersDb();
      const row = db.reminders.find(
        (reminder) => reminder.id === recurringReminderId,
      );
      if (!row) {
        throw new Error("test reminder missing");
      }
      row.remind_at = "2026-01-31T23:30:00.000Z";
      row.recurrence = "monthly";
      row.recurrence_timezone = "UTC";
      row.recurrence_day = 31;
      row.is_enabled = false;

      const response = await request(createTestApp(db))
        .patch(`/api/reminders/${recurringReminderId}`)
        .set("Authorization", "Bearer test-token")
        .send({ isEnabled: true, recurrenceTimezone: "Asia/Tokyo" });

      expect(response.status).toBe(200);
      expect(response.body.reminder.remindAt).toBe("2026-07-31T23:30:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
