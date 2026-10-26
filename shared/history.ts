// SPDX-License-Identifier: MIT

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

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

export type HistoryWindow = {
  configured: DisplayRange;
  bucket: "hour" | "day";
  bars: number;
  clamped: boolean;
  retentionDays: number;
  start: number;
  step: number;
};

export function resolveWindow(
  configured: DisplayRange,
  retentionDays: number,
  now: number,
): HistoryWindow {
  const days = normalizeRetentionDays(retentionDays);
  if (configured === "24h" || days <= 1) {
    const end = Math.floor(now / HOUR_MS) * HOUR_MS;
    const start = Math.floor((now - 24 * HOUR_MS) / HOUR_MS) * HOUR_MS;
    return {
      configured,
      bucket: "hour",
      bars: (end - start) / HOUR_MS + 1,
      clamped: configured !== "24h",
      retentionDays: days,
      start,
      step: HOUR_MS,
    };
  }
  const shown = Math.min(RANGE_DAYS[configured], days);
  const today = utcDayStart(now);
  return {
    configured,
    bucket: "day",
    bars: shown,
    clamped: shown < RANGE_DAYS[configured],
    retentionDays: days,
    start: today - (shown - 1) * DAY_MS,
    step: DAY_MS,
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

export type HistoryBar = {
  start: number;
  uptime: number | null;
  responseMs: number | null;
  state: BarState;
  maint: number;
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

function barFrom(count: CountRow): HistoryBar {
  const maint = count.maint ?? 0;
  return {
    start: count.start,
    uptime: uptimePercent(count.ok, count.fail),
    responseMs: responseAverage(count.sum, count.ok, count.fail),
    state: barState(count.ok, count.fail, maint),
    maint,
  };
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
  live: CountRow | null;
}): HistorySummary {
  const today = utcDayStart(input.now);
  const bars: HistoryBar[] = [];
  let ok = 0;
  let fail = 0;
  let sum = 0;
  let maint = 0;
  for (let index = 0; index < input.window.bars; index += 1) {
    const start = input.window.start + index * input.window.step;
    let count = emptyCount(start);
    if (input.window.bucket === "hour") {
      count = addCount(count, sumRows(input.hourly, start, start + HOUR_MS));
      if (input.live && input.live.start === start) {
        count = addCount(count, { ...input.live, start });
      }
    } else if (start === today) {
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
    bars.push(barFrom(count));
  }
  return {
    uptime: uptimePercent(ok, fail),
    responseMs: responseAverage(sum, ok, fail),
    maint,
    bars,
  };
}
