import { afterEach, describe, expect, it, vi } from "vitest";
import {
  joinDatetimeLocalValue,
  splitDatetimeLocalValue,
  toDatetimeLocalValue,
} from "./datetime";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toDatetimeLocalValue", () => {
  it("formats KST wall-clock time, not UTC", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    // 00:30Z = 09:30 KST — toISOString().slice(0,16) would show 00:30
    expect(toDatetimeLocalValue(new Date("2026-07-10T00:30:00Z"))).toBe(
      "2026-07-10T09:30",
    );
  });

  it("crosses the date boundary in negative-offset zones", () => {
    vi.stubEnv("TZ", "America/New_York");
    // 03:00Z on the 10th = 23:00 on the 9th in EDT (UTC-4)
    expect(toDatetimeLocalValue(new Date("2026-07-10T03:00:00Z"))).toBe(
      "2026-07-09T23:00",
    );
  });

  it("matches UTC when the local zone is UTC", () => {
    vi.stubEnv("TZ", "UTC");
    expect(toDatetimeLocalValue(new Date("2026-07-10T00:30:00Z"))).toBe(
      "2026-07-10T00:30",
    );
  });

  it("round-trips through Date parsing as local time", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const instant = new Date("2026-07-10T00:30:00Z");
    const value = toDatetimeLocalValue(instant);
    // datetime-local strings parse as local time, so the instant survives
    expect(new Date(value).getTime()).toBe(instant.getTime());
  });

  it("zero-pads single-digit fields", () => {
    vi.stubEnv("TZ", "UTC");
    expect(toDatetimeLocalValue(new Date("2026-01-02T03:04:00Z"))).toBe(
      "2026-01-02T03:04",
    );
  });
});

describe("splitDatetimeLocalValue", () => {
  it("splits a datetime-local string into date and time", () => {
    expect(splitDatetimeLocalValue("2026-07-10T09:30")).toEqual({
      date: "2026-07-10",
      time: "09:30",
    });
  });

  it("returns empty parts for an empty value", () => {
    expect(splitDatetimeLocalValue("")).toEqual({ date: "", time: "" });
  });
});

describe("joinDatetimeLocalValue", () => {
  it("recombines date and time", () => {
    expect(joinDatetimeLocalValue("2026-07-10", "09:30")).toBe(
      "2026-07-10T09:30",
    );
  });

  it("returns empty string when either part is missing", () => {
    expect(joinDatetimeLocalValue("", "09:30")).toBe("");
    expect(joinDatetimeLocalValue("2026-07-10", "")).toBe("");
  });

  it("round-trips with splitDatetimeLocalValue", () => {
    const value = "2026-01-02T03:04";
    const { date, time } = splitDatetimeLocalValue(value);
    expect(joinDatetimeLocalValue(date, time)).toBe(value);
  });
});
