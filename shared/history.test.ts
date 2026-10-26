// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  firstRetainedDay,
  fitBars,
  HOUR_MS,
  PRUNE_CATCHUP_INTERVAL_MS,
  PRUNE_DAILY_CAP,
  PRUNE_INTERVAL_MS,
  parsePruneState,
  resolveWindow,
  retentionCutoff,
  SLOT_MS,
  shouldPrune,
  summarizeHistory,
  utcDayStart,
} from "./history";

const now = Date.UTC(2026, 0, 15, 12, 30, 0);

describe("retention bounds", () => {
  it("keeps a day until that day has fully ended before the cutoff", () => {
    const cutoff = retentionCutoff(now, 7);
    const keptFrom = firstRetainedDay(cutoff);
    expect(keptFrom).toBe(utcDayStart(cutoff - DAY_MS) + DAY_MS);
    expect(keptFrom).toBeLessThanOrEqual(cutoff);
    expect(keptFrom + DAY_MS).toBeGreaterThan(cutoff);
    const previousDay = keptFrom - DAY_MS;
    expect(previousDay + DAY_MS).toBeLessThanOrEqual(cutoff);
  });

  it("keeps the UTC day that contains the cutoff", () => {
    const nowMidnight = Date.UTC(2026, 0, 15);
    const cutoff = retentionCutoff(nowMidnight, 1);
    expect(cutoff).toBe(Date.UTC(2026, 0, 14));
    expect(firstRetainedDay(cutoff)).toBe(Date.UTC(2026, 0, 14));
    expect(firstRetainedDay(retentionCutoff(now, 7))).toBe(
      Date.UTC(2026, 0, 8),
    );
  });
});

describe("prune schedule", () => {
  it("runs on the first sight of state and then waits an hour", () => {
    const first = shouldPrune(parsePruneState(null), now);
    expect(first.run).toBe(true);
    expect(first.deletedToday).toBe(0);
    const recent = shouldPrune(
      {
        at: now - 60_000,
        dayStart: utcDayStart(now),
        deleted: 10,
        caughtUp: true,
      },
      now,
    );
    expect(recent.run).toBe(false);
    const due = shouldPrune(
      {
        at: now - PRUNE_INTERVAL_MS,
        dayStart: utcDayStart(now),
        deleted: 10,
        caughtUp: true,
      },
      now,
    );
    expect(due.run).toBe(true);
    expect(due.deletedToday).toBe(10);
  });

  it("catches up five minutes after a full batch and stops at the daily cap", () => {
    const backlog = shouldPrune(
      {
        at: now - PRUNE_CATCHUP_INTERVAL_MS,
        dayStart: utcDayStart(now),
        deleted: 80,
        caughtUp: false,
      },
      now,
    );
    expect(backlog.run).toBe(true);
    const tooSoon = shouldPrune(
      {
        at: now - PRUNE_CATCHUP_INTERVAL_MS + 1,
        dayStart: utcDayStart(now),
        deleted: 80,
        caughtUp: false,
      },
      now,
    );
    expect(tooSoon.run).toBe(false);
    const capped = shouldPrune(
      {
        at: 0,
        dayStart: utcDayStart(now),
        deleted: PRUNE_DAILY_CAP,
        caughtUp: false,
      },
      now,
    );
    expect(capped.run).toBe(false);
    const nextDay = shouldPrune(
      {
        at: now - 60_000,
        dayStart: utcDayStart(now) - DAY_MS,
        deleted: PRUNE_DAILY_CAP,
        caughtUp: true,
      },
      now,
    );
    expect(nextDay.run).toBe(false);
    expect(nextDay.deletedToday).toBe(0);
  });
});

describe("status history windows", () => {
  it("uses 15 minute bars for 24 hours and fewer bars for longer ranges", () => {
    const day = resolveWindow("24h", 90, now);
    expect(day.bucket).toBe("slot");
    expect(day.clamped).toBe(false);
    expect(day.bars).toBe(96);
    expect(day.shownDays).toBe(1);
    expect(day.step).toBe(SLOT_MS);
    expect(day.start).toBe(Date.UTC(2026, 0, 14, 12, 45));
    const week = resolveWindow("7d", 90, now);
    expect(week).toMatchObject({
      bucket: "hour",
      bars: 84,
      clamped: false,
      shownDays: 7,
      step: 2 * HOUR_MS,
    });
    const month = resolveWindow("30d", 90, now);
    expect(month).toMatchObject({
      bucket: "hour",
      bars: 90,
      shownDays: 30,
      step: 8 * HOUR_MS,
    });
    const quarter = resolveWindow("90d", 90, now);
    expect(quarter.bucket).toBe("day");
    expect(quarter.bars).toBe(90);
    expect(quarter.clamped).toBe(false);
    expect(quarter.shownDays).toBe(90);
  });

  it("clamps a page to the history that retention still covers", () => {
    const partial = resolveWindow("90d", 10, now);
    expect(partial).toMatchObject({
      bucket: "day",
      bars: 10,
      clamped: true,
      retentionDays: 10,
      shownDays: 10,
    });
    const oneDay = resolveWindow("30d", 1, now);
    expect(oneDay.bucket).toBe("slot");
    expect(oneDay.clamped).toBe(true);
    expect(oneDay.bars).toBe(96);
    expect(oneDay.shownDays).toBe(1);
    const shorter = resolveWindow("7d", 30, now);
    expect(shorter.clamped).toBe(false);
    expect(shorter.bucket).toBe("hour");
    expect(shorter.bars).toBe(84);
    expect(shorter.shownDays).toBe(7);
  });

  it("sums the chosen buckets without counting a day twice", () => {
    const window = resolveWindow("7d", 90, now);
    const today = utcDayStart(now);
    const yesterday = today - DAY_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [
        { start: yesterday, ok: 9, fail: 1, sum: 90 },
        { start: today, ok: 100, fail: 100, sum: 0 },
      ],
      hourly: [
        { start: yesterday, ok: 50, fail: 50, sum: 0 },
        { start: today, ok: 1, fail: 0, sum: 40 },
        { start: today + HOUR_MS, ok: 1, fail: 1, sum: 20 },
      ],
      live: { start: today + 12 * HOUR_MS, ok: 2, fail: 0, sum: 30 },
    });
    const past = summary.bars.find((bar) => bar.start === yesterday);
    const current = summary.bars.find((bar) => bar.start === today);
    const live = summary.bars.find((bar) => bar.start === today + 12 * HOUR_MS);
    expect(past).toMatchObject({ uptime: 90, responseMs: 9 });
    expect(current).toMatchObject({ uptime: 66.7, responseMs: 20 });
    expect(live).toMatchObject({ uptime: 100, responseMs: 15 });
    expect(summary.uptime).toBe(86.7);
    expect(summary.responseMs).toBe(12);
    expect(summary.bars).toHaveLength(84);
    expect(summary.bars[0]?.uptime).toBeNull();
  });

  it("splits an hour that has no slot rows across the 15 minute bars", () => {
    const window = resolveWindow("24h", 90, now);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [{ start: hour, ok: 1, fail: 1, sum: 30 }],
      live: { start: hour, ok: 1, fail: 0, sum: 15 },
    });
    const bar = summary.bars.find((item) => item.start === hour);
    expect(bar).toMatchObject({ uptime: 66.7, responseMs: 15 });
    expect(summary.bars).toHaveLength(96);
    expect(summary.responseMs).toBe(15);
  });

  it("leaves maintenance samples out of the uptime ratio", () => {
    const window = resolveWindow("24h", 90, now);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [
        { start: hour - HOUR_MS, ok: 0, fail: 0, sum: 0, maint: 4 },
        { start: hour, ok: 9, fail: 1, sum: 100, maint: 6 },
      ],
      live: null,
    });
    const maintained = summary.bars.find((bar) => bar.start === hour - HOUR_MS);
    const mixed = summary.bars.find((bar) => bar.start === hour);
    expect(maintained).toMatchObject({
      uptime: null,
      state: "maintenance",
      maint: 1,
    });
    expect(mixed).toMatchObject({ uptime: 90, state: "degraded", maint: 1.5 });
    const end = Math.floor(now / SLOT_MS) * SLOT_MS;
    const slotsIntoHour = (end - hour) / SLOT_MS + 1;
    expect(summary.uptime).toBe(90);
    expect(summary.maint).toBe(4 + 6 * (slotsIntoHour / 4));
  });

  it("paints a maintenance slot without borrowing the rest of the hour", () => {
    const window = resolveWindow("24h", 90, now);
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const hour = Math.floor(slot / HOUR_MS) * HOUR_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [{ start: hour, ok: 9, fail: 1, sum: 100, maint: 6 }],
      slots: [{ start: slot, ok: 0, fail: 0, sum: 0, maint: 2 }],
      live: null,
    });
    const bar = summary.bars.find((item) => item.start === slot);
    const neighbor = summary.bars.find((item) => item.start === slot - SLOT_MS);
    expect(bar).toMatchObject({
      uptime: null,
      state: "maintenance",
      maint: 2,
    });
    expect(neighbor).toMatchObject({ uptime: null, state: "empty", maint: 0 });
    expect(summary.uptime).toBe(90);
  });

  it("counts incidents on overlapping bars and merges them for a narrow screen", () => {
    const window = resolveWindow("24h", 90, now);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [],
      slots: [{ start: hour, ok: 1, fail: 0, sum: 10 }],
      live: null,
      incidents: [{ start: hour, end: hour + 20 * 60 * 1000 }],
    });
    const first = summary.bars.find((bar) => bar.start === hour);
    const next = summary.bars.find((bar) => bar.start === hour + SLOT_MS);
    expect(first).toMatchObject({ uptime: 100, incidents: 1 });
    expect(next).toMatchObject({ uptime: null, incidents: 1 });
    const fitted = fitBars(summary.bars, 48);
    expect(fitted).toHaveLength(48);
    const sourceIncidents = summary.bars.reduce(
      (total, bar) => total + bar.incidents,
      0,
    );
    const fittedIncidents = fitted.reduce(
      (total, bar) => total + bar.incidents,
      0,
    );
    expect(sourceIncidents).toBe(2);
    expect(fittedIncidents).toBe(sourceIncidents);
    const merged = fitted.find((bar) => bar.incidents > 0);
    expect(merged?.maint).toBe(0);
    expect(fitBars(summary.bars, 96)).toHaveLength(96);
  });
});
