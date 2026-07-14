import type { ReminderRecurrence } from "@my-bookmark/shared";

type RepeatingRecurrence = Exclude<ReminderRecurrence, "none">;

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function assertReminderTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch (error) {
    throw new Error("Invalid reminder timezone", { cause: error });
  }
}

export function localDayInTimezone(date: Date, timeZone: string): number {
  assertReminderTimezone(timeZone);
  return localParts(date, timeZone).day;
}

export function nextReminderAt({
  scheduledAt,
  recurrence,
  timeZone,
  now,
  recurrenceDay,
}: {
  scheduledAt: Date;
  recurrence: RepeatingRecurrence;
  timeZone: string;
  now: Date;
  recurrenceDay?: number | null;
}): Date {
  assertReminderTimezone(timeZone);
  let local = localParts(scheduledAt, timeZone);
  for (let attempts = 0; attempts < 10_000; attempts += 1) {
    local = incrementLocal(local, recurrence, recurrenceDay ?? local.day);
    const candidate = localToDate(local, timeZone);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  throw new Error("Unable to calculate next reminder occurrence");
}

function localParts(date: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const value = (key: Intl.DateTimeFormatPartTypes) => {
    const result = values.get(key);
    if (result === undefined || !Number.isFinite(result)) {
      throw new Error(`Unable to read reminder date part: ${key}`);
    }
    return result;
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function incrementLocal(
  local: LocalDateTime,
  recurrence: RepeatingRecurrence,
  recurrenceDay: number,
): LocalDateTime {
  if (recurrence === "monthly") {
    const nextMonth = local.month === 12 ? 1 : local.month + 1;
    const nextYear = local.month === 12 ? local.year + 1 : local.year;
    return {
      ...local,
      year: nextYear,
      month: nextMonth,
      day: Math.min(recurrenceDay, daysInMonth(nextYear, nextMonth)),
    };
  }
  const calendar = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day + (recurrence === "weekly" ? 7 : 1),
      local.hour,
      local.minute,
      local.second,
    ),
  );
  return {
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
    hour: calendar.getUTCHours(),
    minute: calendar.getUTCMinutes(),
    second: calendar.getUTCSeconds(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localToDate(local: LocalDateTime, timeZone: string): Date {
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const firstCandidate = new Date(
    localAsUtc - timezoneOffset(new Date(localAsUtc), timeZone),
  );
  return new Date(localAsUtc - timezoneOffset(firstCandidate, timeZone));
}

function timezoneOffset(date: Date, timeZone: string): number {
  const local = localParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}
