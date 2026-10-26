// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./history";
import {
  classifySchedule,
  formatLocalInput,
  type MaintenanceSchedule,
  nextOccurrences,
  occurrenceContaining,
  parseLocalInput,
  zonedTimeToUtc,
} from "./recurrence";

const zone = "America/New_York";

function schedule(
  overrides: Partial<MaintenanceSchedule> = {},
): MaintenanceSchedule {
  const startAt = zonedTimeToUtc(
    { year: 2026, month: 3, day: 7, hour: 9, minute: 0, second: 0 },
    zone,
  );
  return {
    startAt,
    endAt: startAt + HOUR_MS,
    timezone: zone,
    recurrence: "daily",
    weekdays: [],
    cancelledAt: null,
    ...overrides,
  };
}

describe("recurrence", () => {
  it("keeps a daily local time across the spring-forward", () => {
    const row = schedule();
    const nextDay = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 9, minute: 0, second: 0 },
      zone,
    );
    const found = nextOccurrences(row, row.startAt, 2);
    expect(found[0]?.start).toBe(row.startAt);
    expect(found[1]?.start).toBe(nextDay);
    expect(nextDay - row.startAt).toBe(23 * HOUR_MS);
  });

  it("keeps a daily local time across the fall-back", () => {
    const startAt = zonedTimeToUtc(
      { year: 2026, month: 10, day: 31, hour: 9, minute: 0, second: 0 },
      zone,
    );
    const row = schedule({ startAt, endAt: startAt + HOUR_MS });
    const nextDay = zonedTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 9, minute: 0, second: 0 },
      zone,
    );
    expect(nextOccurrences(row, startAt, 2)[1]?.start).toBe(nextDay);
    expect(nextDay - startAt).toBe(25 * HOUR_MS);
  });

  it("repeats weekly only on the chosen weekdays", () => {
    const startAt = zonedTimeToUtc(
      { year: 2026, month: 10, day: 26, hour: 1, minute: 0, second: 0 },
      "UTC",
    );
    const row = schedule({
      startAt,
      endAt: startAt + 2 * HOUR_MS,
      timezone: "UTC",
      recurrence: "weekly",
      weekdays: [1, 3],
    });
    const starts = nextOccurrences(row, startAt, 4).map((item) => item.start);
    expect(starts).toEqual([
      startAt,
      startAt + 2 * 24 * HOUR_MS,
      startAt + 7 * 24 * HOUR_MS,
      startAt + 9 * 24 * HOUR_MS,
    ]);
  });

  it("clamps a monthly window to the last day of a short month", () => {
    const startAt = zonedTimeToUtc(
      { year: 2026, month: 1, day: 31, hour: 4, minute: 0, second: 0 },
      "UTC",
    );
    const row = schedule({
      startAt,
      endAt: startAt + HOUR_MS,
      timezone: "UTC",
      recurrence: "monthly",
    });
    const february = nextOccurrences(row, startAt + 24 * HOUR_MS, 1)[0];
    expect(february?.start).toBe(Date.UTC(2026, 1, 28, 4, 0, 0));
  });

  it("stops an active window at cancellation", () => {
    const row = schedule({ timezone: "UTC", recurrence: "once" });
    const utc = schedule({
      startAt: Date.UTC(2026, 9, 26, 12, 0, 0),
      endAt: Date.UTC(2026, 9, 26, 14, 0, 0),
      timezone: "UTC",
      recurrence: "once",
      cancelledAt: Date.UTC(2026, 9, 26, 13, 0, 0),
    });
    expect(row.recurrence).toBe("once");
    const during = Date.UTC(2026, 9, 26, 12, 30, 0);
    expect(occurrenceContaining(utc, during)?.end).toBe(utc.cancelledAt);
    expect(classifySchedule(utc, Date.UTC(2026, 9, 26, 13, 30, 0))).toBe(
      "past",
    );
    expect(classifySchedule(utc, during)).toBe("active");
  });

  it("round-trips a local datetime input", () => {
    const ms = parseLocalInput("2026-06-15T09:30", "UTC");
    expect(ms).toBe(Date.UTC(2026, 5, 15, 9, 30, 0));
    expect(formatLocalInput(ms ?? 0, "UTC")).toBe("2026-06-15T09:30");
    expect(parseLocalInput("2026-02-31T00:00", "UTC")).toBeNull();
  });
});
