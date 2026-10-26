// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { DAY_MS, utcDayStart } from "../../shared/history";
import { aggregateClosedDays } from "./daily";

describe("daily rollup oracle", () => {
  it("matches integer UTC days with the calendar helper", () => {
    let mismatches = 0;
    for (
      let hour = Date.UTC(2020, 0, 1);
      hour < Date.UTC(2030, 0, 1);
      hour += 3_600_000
    ) {
      if (Math.floor(hour / DAY_MS) * DAY_MS !== utcDayStart(hour)) {
        mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
    expect(DAY_MS).toBe(86_400_000);
  });

  it("sums closed days and skips the open UTC day", () => {
    const today = Date.UTC(2024, 5, 3);
    const yesterday = today - DAY_MS;
    const older = yesterday - DAY_MS;
    const rows = aggregateClosedDays(
      [
        {
          monitorId: "a",
          hourStart: older + 3_600_000,
          ok: 2,
          fail: 1,
          sum: 30,
          max: 20,
          maint: 1,
        },
        {
          monitorId: "a",
          hourStart: older + 7_200_000,
          ok: 1,
          fail: 0,
          sum: 5,
          max: 40,
          maint: 0,
        },
        {
          monitorId: "b",
          hourStart: yesterday,
          ok: 4,
          fail: 2,
          sum: 10,
          max: 3,
          maint: 5,
        },
        {
          monitorId: "a",
          hourStart: today + 3_600_000,
          ok: 9,
          fail: 9,
          sum: 9,
          max: 9,
          maint: 9,
        },
      ],
      today + 3_600_000,
    );
    expect(rows).toEqual([
      {
        monitorId: "a",
        dayStart: older,
        ok: 3,
        fail: 1,
        sum: 35,
        max: 40,
        maint: 1,
      },
      {
        monitorId: "b",
        dayStart: yesterday,
        ok: 4,
        fail: 2,
        sum: 10,
        max: 3,
        maint: 5,
      },
    ]);
  });
});
