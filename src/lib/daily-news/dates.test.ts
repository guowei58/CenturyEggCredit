import { describe, expect, it } from "vitest";

import { formatNyDateKey, publishedOnNyDateKey } from "./dates";

describe("publishedOnNyDateKey", () => {
  it("matches ISO timestamps on the same NY calendar day", () => {
    const dateKey = "2026-06-15";
    expect(publishedOnNyDateKey("2026-06-15T18:30:00.000Z", dateKey)).toBe(true);
  });

  it("rejects articles from prior NY calendar days", () => {
    const dateKey = "2026-06-15";
    expect(publishedOnNyDateKey("2026-06-14T23:59:00.000Z", dateKey)).toBe(false);
    expect(publishedOnNyDateKey("2026-06-13", dateKey)).toBe(false);
  });

  it("rejects missing publishedAt", () => {
    expect(publishedOnNyDateKey(null, "2026-06-15")).toBe(false);
    expect(publishedOnNyDateKey("", "2026-06-15")).toBe(false);
  });

  it("uses NY timezone for late-evening UTC timestamps", () => {
    const windowEnd = new Date("2026-06-16T03:30:00.000Z");
    const dateKey = formatNyDateKey(windowEnd);
    expect(dateKey).toBe("2026-06-15");
    expect(publishedOnNyDateKey("2026-06-16T02:00:00.000Z", dateKey)).toBe(true);
    expect(publishedOnNyDateKey("2026-06-15T03:00:00.000Z", dateKey)).toBe(false);
  });
});
