// SPDX-License-Identifier: MIT

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** Status-page bars for the last 24 hours. Four rows per hour, closed once. */
export const SLOT_MS = 15 * 60 * 1000;
const SLOT_BARS = 96;
const WEEK_STEP = 2 * HOUR_MS;
const WEEK_BARS_PER_DAY = 12;
const MONTH_STEP = 8 * HOUR_MS;
const MONTH_BARS_PER_DAY = 3;

export const DISPLAY_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type DisplayRange = (typeof DISPLAY_RANGES)[number];

export const RANGE_DAYS: Record<DisplayRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const RETENTION_PRESETS = [7, 30, 90, 180, 365] as const;
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

/** Rows deleted per table per run. Stays under D1's 100 bound parameters. */
export const PRUNE_BATCH = 80;
/** Steady-state gap between prune runs. */
export const PRUNE_INTERVAL_MS = HOUR_MS;
/** Gap while a previous run filled its batch and more rows may remain. */
export const PRUNE_CATCHUP_INTERVAL_MS = 5 * 60_000;
/**
 * Delete budget for one UTC day.
 * D1's free plan allows 100,000 row writes per day. Checks, mail, and
 * rollups share that budget, so pruning stops after 20,000 deletes.
 */
export const PRUNE_DAILY_CAP = 20_000;

export const HISTORY_RETENTION_KEY = "history_retention_days";
export const HISTORY_PRUNE_STATE_KEY = "history_prune_state";

export type PruneState = {
  at: number;
  dayStart: number;
  deleted: number;
  caughtUp: boolean;
};

export function emptyPruneState(): PruneState {
  return { at: 0, dayStart: 0, deleted: 0, caughtUp: true };
}

export function utcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isDisplayRange(value: string): value is DisplayRange {
  return (DISPLAY_RANGES as readonly string[]).includes(value);
}

export function parseDisplayRange(
  value: string | null | undefined,
): DisplayRange {
  if (value && isDisplayRange(value)) return value;
  return "24h";
}

export function normalizeRetentionDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_RETENTION_DAYS;
  }
  if (value < MIN_RETENTION_DAYS || value > MAX_RETENTION_DAYS) {
    return DEFAULT_RETENTION_DAYS;
  }
  return value;
}

export function retentionCutoff(now: number, retentionDays: number): number {
  return now - normalizeRetentionDays(retentionDays) * DAY_MS;
}

/**
 * First UTC midnight that still overlaps the retention window.
 * Daily totals are rebuilt from whatever hourly rows remain, so both
 * tables keep every hour of a day until that whole day is outside.
 */
export function firstRetainedDay(cutoff: number): number {
  return utcDayStart(cutoff - DAY_MS) + DAY_MS;
}

export function parsePruneState(value: unknown): PruneState {
  if (!value || typeof value !== "object") return emptyPruneState();
  const row = value as Partial<PruneState>;
  return {
    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
    dayStart:
      typeof row.dayStart === "number" && Number.isFinite(row.dayStart)
        ? row.dayStart
        : 0,
    deleted:
      typeof row.deleted === "number" &&
      Number.isFinite(row.deleted) &&
      row.deleted > 0
        ? row.deleted
        : 0,
    caughtUp: row.caughtUp !== false,
  };
}

export function shouldPrune(
  state: PruneState,
  now: number,
): { run: boolean; deletedToday: number; dayStart: number } {
  const dayStart = utcDayStart(now);
  const deletedToday = state.dayStart === dayStart ? state.deleted : 0;
  if (deletedToday >= PRUNE_DAILY_CAP) {
    return { run: false, deletedToday, dayStart };
  }
  if (state.at <= 0) return { run: true, deletedToday, dayStart };
  const elapsed = now - state.at;
  if (!state.caughtUp && elapsed >= PRUNE_CATCHUP_INTERVAL_MS) {
    return { run: true, deletedToday, dayStart };
  }
  if (elapsed >= PRUNE_INTERVAL_MS) {
    return { run: true, deletedToday, dayStart };
  }
  return { run: false, deletedToday, dayStart };
}

export type HistoryBucket = "slot" | "hour" | "day";

export type HistoryWindow = {
  configured: DisplayRange;
  bucket: HistoryBucket;
  bars: number;
  clamped: boolean;
  retentionDays: number;
  start: number;
  step: number;
  shownDays: number;
};

function alignDown(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

export function resolveWindow(
  configured: DisplayRange,
  retentionDays: number,
  now: number,
): HistoryWindow {
  const days = normalizeRetentionDays(retentionDays);
  if (configured === "24h" || days <= 1) {
    const end = alignDown(now, SLOT_MS);
    return {
      configured,
      bucket: "slot",
      bars: SLOT_BARS,
      clamped: configured !== "24h",
      retentionDays: days,
      start: end - (SLOT_BARS - 1) * SLOT_MS,
      step: SLOT_MS,
      shownDays: 1,
    };
  }
  if (configured === "7d") {
    const shown = Math.min(RANGE_DAYS["7d"], days);
    const bars = shown * WEEK_BARS_PER_DAY;
    const end = alignDown(now, WEEK_STEP);
    return {
      configured,
      bucket: "hour",
      bars,
      clamped: shown < RANGE_DAYS["7d"],
      retentionDays: days,
      start: end - (bars - 1) * WEEK_STEP,
      step: WEEK_STEP,
      shownDays: shown,
    };
  }
  if (configured === "30d") {
    const shown = Math.min(RANGE_DAYS["30d"], days);
    const bars = shown * MONTH_BARS_PER_DAY;
    const end = alignDown(now, MONTH_STEP);
    return {
      configured,
      bucket: "hour",
      bars,
      clamped: shown < RANGE_DAYS["30d"],
      retentionDays: days,
      start: end - (bars - 1) * MONTH_STEP,
      step: MONTH_STEP,
      shownDays: shown,
    };
  }
  const shown = Math.min(RANGE_DAYS["90d"], days);
  const today = utcDayStart(now);
  return {
    configured,
    bucket: "day",
    bars: shown,
    clamped: shown < RANGE_DAYS["90d"],
    retentionDays: days,
    start: today - (shown - 1) * DAY_MS,
    step: DAY_MS,
    shownDays: shown,
  };
}

export type CountRow = {
  start: number;
  ok: number;
  fail: number;
  sum: number;
  /** Checks that ran inside a maintenance window. Left out of uptime. */
  maint?: number;
};

export type BarState = "empty" | "up" | "degraded" | "down" | "maintenance";

export type IncidentSpan = {
  start: number;
  end: number | null;
};

export type HistoryBar = {
  start: number;
  end: number;
  uptime: number | null;
  responseMs: number | null;
  state: BarState;
  maint: number;
  incidents: number;
  ok: number;
  fail: number;
  sum: number;
};

export type HistorySummary = {
  uptime: number | null;
  responseMs: number | null;
  maint: number;
  bars: HistoryBar[];
};

export function uptimePercent(ok: number, fail: number): number | null {
  const total = ok + fail;
  if (total === 0) return null;
  return Math.round((ok / total) * 1000) / 10;
}

/** Maintenance samples do not move the percentage. A bucket of only those is maintenance. */
export function barState(ok: number, fail: number, maint: number): BarState {
  if (ok + fail === 0) return maint > 0 ? "maintenance" : "empty";
  const uptime = uptimePercent(ok, fail) ?? 0;
  if (uptime >= 99) return "up";
  if (uptime >= 90) return "degraded";
  return "down";
}

export function responseAverage(
  sum: number,
  ok: number,
  fail: number,
): number | null {
  const total = ok + fail;
  if (total === 0) return null;
  return Math.round(sum / total);
}

function emptyCount(start: number): CountRow {
  return { start, ok: 0, fail: 0, sum: 0, maint: 0 };
}

function addCount(base: CountRow, extra: CountRow): CountRow {
  return {
    start: base.start,
    ok: base.ok + extra.ok,
    fail: base.fail + extra.fail,
    sum: base.sum + extra.sum,
    maint: (base.maint ?? 0) + (extra.maint ?? 0),
  };
}

function barFrom(count: CountRow, end: number, incidents: number): HistoryBar {
  const maint = count.maint ?? 0;
  return {
    start: count.start,
    end,
    uptime: uptimePercent(count.ok, count.fail),
    responseMs: responseAverage(count.sum, count.ok, count.fail),
    state: barState(count.ok, count.fail, maint),
    maint,
    incidents,
    ok: count.ok,
    fail: count.fail,
    sum: count.sum,
  };
}

function incidentCount(
  spans: IncidentSpan[],
  start: number,
  end: number,
): number {
  let count = 0;
  for (const span of spans) {
    const stop = span.end ?? Number.POSITIVE_INFINITY;
    if (span.start < end && stop > start) count += 1;
  }
  return count;
}

function scaleCount(
  count: CountRow,
  start: number,
  fraction: number,
): CountRow {
  return {
    start,
    ok: count.ok * fraction,
    fail: count.fail * fraction,
    sum: count.sum * fraction,
    maint: (count.maint ?? 0) * fraction,
  };
}

function overlapFraction(
  start: number,
  step: number,
  from: number,
  until: number,
): number {
  const overlapStart = Math.max(start, from);
  const overlapEnd = Math.min(start + step, until);
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / step;
}

export function fitBars(bars: HistoryBar[], max: number): HistoryBar[] {
  if (max < 1 || bars.length <= max) return bars;
  const size = Math.ceil(bars.length / max);
  const grouped: HistoryBar[] = [];
  for (let index = 0; index < bars.length; index += size) {
    const chunk = bars.slice(index, index + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    const count = emptyCount(first.start);
    let incidents = 0;
    for (const bar of chunk) {
      count.ok += bar.ok;
      count.fail += bar.fail;
      count.sum += bar.sum;
      count.maint = (count.maint ?? 0) + bar.maint;
      incidents += bar.incidents;
    }
    grouped.push(barFrom(count, last.end, incidents));
  }
  return grouped;
}

function sumRows(rows: CountRow[], from: number, until: number): CountRow {
  const total = emptyCount(from);
  for (const row of rows) {
    if (row.start >= from && row.start < until) {
      total.ok += row.ok;
      total.fail += row.fail;
      total.sum += row.sum;
      total.maint = (total.maint ?? 0) + (row.maint ?? 0);
    }
  }
  return total;
}

export function summarizeHistory(input: {
  window: HistoryWindow;
  now: number;
  hourly: CountRow[];
  daily: CountRow[];
  slots?: CountRow[];
  live: CountRow | null;
  liveSlot?: CountRow | null;
  incidents?: IncidentSpan[];
}): HistorySummary {
  const incidents = input.incidents ?? [];
  if (input.window.bucket === "slot") return summarizeSlots(input, incidents);
  if (input.window.bucket === "hour") return summarizeSpans(input, incidents);
  return summarizeDays(input, incidents);
}

function summarizeSlots(
  input: {
    window: HistoryWindow;
    hourly: CountRow[];
    live: CountRow | null;
    slots?: CountRow[];
    liveSlot?: CountRow | null;
  },
  incidents: IncidentSpan[],
): HistorySummary {
  const slots = input.slots ?? [];
  const windowEnd = input.window.start + input.window.bars * input.window.step;
  let ok = 0;
  let fail = 0;
  let sum = 0;
  let maint = 0;
  for (const row of input.hourly) {
    const fraction = overlapFraction(
      row.start,
      HOUR_MS,
      input.window.start,
      windowEnd,
    );
    ok += row.ok * fraction;
    fail += row.fail * fraction;
    sum += row.sum * fraction;
    maint += (row.maint ?? 0) * fraction;
  }
  if (input.live) {
    const fraction = overlapFraction(
      input.live.start,
      HOUR_MS,
      input.window.start,
      windowEnd,
    );
    ok += input.live.ok * fraction;
    fail += input.live.fail * fraction;
    sum += input.live.sum * fraction;
    maint += (input.live.maint ?? 0) * fraction;
  }
  const hoursWithSlots = new Set<number>();
  for (const slot of slots) {
    hoursWithSlots.add(Math.floor(slot.start / HOUR_MS) * HOUR_MS);
  }
  if (input.liveSlot) {
    hoursWithSlots.add(Math.floor(input.liveSlot.start / HOUR_MS) * HOUR_MS);
  }
  const bars: HistoryBar[] = [];
  for (let index = 0; index < input.window.bars; index += 1) {
    const start = input.window.start + index * input.window.step;
    const end = start + input.window.step;
    let count = sumRows(slots, start, end);
    if (input.liveSlot && input.liveSlot.start === start) {
      count = addCount(count, { ...input.liveSlot, start });
    }
    if (count.ok + count.fail + (count.maint ?? 0) === 0) {
      const hourStart = Math.floor(start / HOUR_MS) * HOUR_MS;
      if (!hoursWithSlots.has(hourStart)) {
        let hour = sumRows(input.hourly, hourStart, hourStart + HOUR_MS);
        if (input.live && input.live.start === hourStart) {
          hour = addCount(hour, { ...input.live, start: hourStart });
        }
        if (hour.ok + hour.fail + (hour.maint ?? 0) > 0) {
          count = scaleCount(hour, start, input.window.step / HOUR_MS);
        }
      }
    }
    bars.push(barFrom(count, end, incidentCount(incidents, start, end)));
  }
  return {
    uptime: uptimePercent(ok, fail),
    responseMs: responseAverage(sum, ok, fail),
    maint,
    bars,
  };
}

function summarizeSpans(
  input: {
    window: HistoryWindow;
    now: number;
    hourly: CountRow[];
    daily: CountRow[];
    live: CountRow | null;
  },
  incidents: IncidentSpan[],
): HistorySummary {
  const today = utcDayStart(input.now);
  const windowEnd = input.window.start + input.window.bars * input.window.step;
  const dailyByDay = new Map(input.daily.map((row) => [row.start, row]));
  let ok = 0;
  let fail = 0;
  let sum = 0;
  let maint = 0;
  for (
    let day = utcDayStart(input.window.start);
    day < windowEnd;
    day += DAY_MS
  ) {
    const from = Math.max(day, input.window.start);
    const until = Math.min(day + DAY_MS, windowEnd);
    if (day === today) {
      const part = sumRows(input.hourly, from, until);
      ok += part.ok;
      fail += part.fail;
      sum += part.sum;
      maint += part.maint ?? 0;
      if (input.live && input.live.start >= from && input.live.start < until) {
        ok += input.live.ok;
        fail += input.live.fail;
        sum += input.live.sum;
        maint += input.live.maint ?? 0;
      }
      continue;
    }
    const daily = dailyByDay.get(day);
    if (daily) {
      const fraction = (until - from) / DAY_MS;
      ok += daily.ok * fraction;
      fail += daily.fail * fraction;
      sum += daily.sum * fraction;
      maint += (daily.maint ?? 0) * fraction;
      continue;
    }
    const part = sumRows(input.hourly, from, until);
    ok += part.ok;
    fail += part.fail;
    sum += part.sum;
    maint += part.maint ?? 0;
  }
  const bars: HistoryBar[] = [];
  for (let index = 0; index < input.window.bars; index += 1) {
    const start = input.window.start + index * input.window.step;
    const end = start + input.window.step;
    let count = emptyCount(start);
    for (const row of input.hourly) {
      if (row.start < start || row.start >= end) continue;
      const day = utcDayStart(row.start);
      if (day !== today && dailyByDay.has(day)) continue;
      count = addCount(count, { ...row, start });
    }
    if (
      input.live &&
      input.live.start >= start &&
      input.live.start < end &&
      utcDayStart(input.live.start) === today
    ) {
      count = addCount(count, { ...input.live, start });
    }
    for (
      let day = utcDayStart(start);
      day < end && day !== today;
      day += DAY_MS
    ) {
      const daily = dailyByDay.get(day);
      if (!daily) continue;
      const overlapStart = Math.max(start, day);
      const overlapEnd = Math.min(end, day + DAY_MS);
      const fraction = (overlapEnd - overlapStart) / DAY_MS;
      count = addCount(count, scaleCount(daily, start, fraction));
    }
    bars.push(barFrom(count, end, incidentCount(incidents, start, end)));
  }
  return {
    uptime: uptimePercent(ok, fail),
    responseMs: responseAverage(sum, ok, fail),
    maint,
    bars,
  };
}

function summarizeDays(
  input: {
    window: HistoryWindow;
    now: number;
    hourly: CountRow[];
    daily: CountRow[];
    live: CountRow | null;
  },
  incidents: IncidentSpan[],
): HistorySummary {
  const today = utcDayStart(input.now);
  const bars: HistoryBar[] = [];
  let ok = 0;
  let fail = 0;
  let sum = 0;
  let maint = 0;
  for (let index = 0; index < input.window.bars; index += 1) {
    const start = input.window.start + index * input.window.step;
    const end = start + input.window.step;
    let count = emptyCount(start);
    if (start === today) {
      // Today's daily row is not rolled yet. Hourly rows plus the unflushed
      // hour are the whole day. Ignore a daily row so it cannot be added twice.
      count = addCount(count, sumRows(input.hourly, start, start + DAY_MS));
      if (
        input.live &&
        input.live.start >= start &&
        input.live.start < start + DAY_MS
      ) {
        count = addCount(count, { ...input.live, start });
      }
    } else {
      const daily = input.daily.find((row) => row.start === start);
      count = daily
        ? {
            start,
            ok: daily.ok,
            fail: daily.fail,
            sum: daily.sum,
            maint: daily.maint ?? 0,
          }
        : addCount(count, sumRows(input.hourly, start, start + DAY_MS));
    }
    ok += count.ok;
    fail += count.fail;
    sum += count.sum;
    maint += count.maint ?? 0;
    bars.push(barFrom(count, end, incidentCount(incidents, start, end)));
  }
  return {
    uptime: uptimePercent(ok, fail),
    responseMs: responseAverage(sum, ok, fail),
    maint,
    bars,
  };
}
