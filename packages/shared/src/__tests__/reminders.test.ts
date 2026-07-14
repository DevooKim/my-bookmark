import {
  createReminderRequestSchema,
  reminderSchema,
  rescheduleReminderRequestSchema,
} from "@my-bookmark/shared";
import { describe, expect, it } from "vitest";

const bookmarkId = "11111111-1111-4111-8111-111111111111";
const reminderId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const remindAt = "2026-08-01T01:00:00.000Z";

describe("reminder recurrence contracts", () => {
  it("parses recurrence settings at the request and response boundaries", () => {
    expect(
      createReminderRequestSchema.parse({
        bookmarkId,
        remindAt,
        recurrence: "weekly",
        recurrenceTimezone: "Asia/Seoul",
      }),
    ).toMatchObject({
      recurrence: "weekly",
      recurrenceTimezone: "Asia/Seoul",
    });

    expect(
      reminderSchema.parse({
        id: reminderId,
        userId,
        bookmarkId,
        remindAt,
        note: null,
        status: "pending",
        sentAt: null,
        createdAt: remindAt,
        recurrence: "weekly",
        recurrenceTimezone: "Asia/Seoul",
        isEnabled: true,
      }),
    ).toMatchObject({
      recurrence: "weekly",
      recurrenceTimezone: "Asia/Seoul",
      isEnabled: true,
    });
  });

  it("rejects unsupported recurrence values", () => {
    expect(() =>
      createReminderRequestSchema.parse({
        bookmarkId,
        remindAt,
        recurrence: "hourly",
        recurrenceTimezone: "Asia/Seoul",
      }),
    ).toThrow();
  });

  it("requires a complete future schedule when reusing a reminder", () => {
    expect(
      rescheduleReminderRequestSchema.parse({
        remindAt,
        note: "다시 보기",
        recurrence: "monthly",
        recurrenceTimezone: "Asia/Seoul",
      }),
    ).toEqual({
      remindAt,
      note: "다시 보기",
      recurrence: "monthly",
      recurrenceTimezone: "Asia/Seoul",
    });
    expect(() =>
      rescheduleReminderRequestSchema.parse({
        remindAt,
        recurrence: "monthly",
      }),
    ).toThrow();
  });
});
