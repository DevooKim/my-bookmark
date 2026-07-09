import { afterEach, describe, expect, it, vi } from "vitest";
import { toDatetimeLocalValue } from "./datetime";

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
