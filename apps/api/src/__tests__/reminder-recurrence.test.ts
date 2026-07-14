import { describe, expect, it } from "vitest";
import {
  assertReminderTimezone,
  localDayInTimezone,
  nextReminderAt,
} from "../services/reminder-recurrence";

describe("reminder recurrence", () => {
  it.each([
    ["daily", "2026-07-16T00:00:00.000Z"],
    ["weekly", "2026-07-22T00:00:00.000Z"],
  ] as const)("keeps the local time for %s recurrence", (recurrence, next) => {
    expect(
      nextReminderAt({
        scheduledAt: new Date("2026-07-15T00:00:00.000Z"),
        recurrence,
        timeZone: "Asia/Seoul",
        now: new Date("2026-07-15T00:00:00.000Z"),
      }).toISOString(),
    ).toBe(next);
  });

  it("keeps the monthly anchor day after clamping a short month", () => {
    const february = nextReminderAt({
      scheduledAt: new Date("2026-01-31T00:00:00.000Z"),
      recurrence: "monthly",
      recurrenceDay: 31,
      timeZone: "Asia/Seoul",
      now: new Date("2026-01-31T00:00:00.000Z"),
    });
    const march = nextReminderAt({
      scheduledAt: february,
      recurrence: "monthly",
      recurrenceDay: 31,
      timeZone: "Asia/Seoul",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(february.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(march.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("skips missed occurrences and preserves local time across DST", () => {
    expect(
      nextReminderAt({
        scheduledAt: new Date("2026-03-07T14:00:00.000Z"),
        recurrence: "daily",
        timeZone: "America/New_York",
        now: new Date("2026-03-08T12:00:00.000Z"),
      }).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");

    expect(
      nextReminderAt({
        scheduledAt: new Date("2026-07-10T00:00:00.000Z"),
        recurrence: "daily",
        timeZone: "Asia/Seoul",
        now: new Date("2026-07-15T12:00:00.000Z"),
      }).toISOString(),
    ).toBe("2026-07-16T00:00:00.000Z");
  });

  it("validates timezones and returns the local monthly anchor day", () => {
    expect(
      localDayInTimezone(new Date("2026-01-31T16:00:00.000Z"), "Asia/Seoul"),
    ).toBe(1);
    expect(() => assertReminderTimezone("Mars/Olympus_Mons")).toThrow(
      "Invalid reminder timezone",
    );
  });
});
