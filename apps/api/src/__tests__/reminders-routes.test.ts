import { API_ERROR_CODES } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createRemindersRouter } from "../routes/reminders";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";
const otherBookmarkId = "33333333-3333-4333-8333-333333333333";
const reminderId = "44444444-4444-4444-8444-444444444444";

interface ReminderRow {
  id: string;
  user_id: string;
  bookmark_id: string;
  remind_at: string;
  note: string | null;
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
  created_at: string;
  bookmarks: {
    id: string;
    kind: "link" | "image";
    url: string | null;
    title: string | null;
  } | null;
}

class FakeRemindersDb {
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
      created_at: "2026-07-10T12:00:00.000Z",
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

  bookmarkBelongsToUser(userIdValue: string, bookmarkIdValue: string) {
    return Promise.resolve(this.bookmarks.get(bookmarkIdValue) === userIdValue);
  }

  createReminder(input: {
    userId: string;
    bookmarkId: string;
    remindAt: string;
    note: string | null;
  }) {
    const row: ReminderRow = {
      id: "55555555-5555-4555-8555-555555555555",
      user_id: input.userId,
      bookmark_id: input.bookmarkId,
      remind_at: input.remindAt,
      note: input.note,
      status: "pending",
      sent_at: null,
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
    remindAt?: string;
    note?: string | null;
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
    if (input.remindAt !== undefined) {
      row.remind_at = input.remindAt;
    }
    if (input.note !== undefined) {
      row.note = input.note;
    }
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
  it("rejects reminder creation when remindAt is not in the future", async () => {
    const app = createTestApp(new FakeRemindersDb());

    const response = await request(app)
      .post("/api/reminders")
      .set("Authorization", "Bearer test-token")
      .send({
        bookmarkId,
        remindAt: new Date(Date.now() - 1000).toISOString(),
        note: "too late",
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
      });

    expect(sentResponse.status).toBe(404);
    expect(missingResponse.status).toBe(400);
    expect(missingResponse.body.error.code).toBe(
      API_ERROR_CODES.VALIDATION_ERROR,
    );
  });
});
