// SPDX-License-Identifier: MIT

import { DAY_MS, utcDayStart } from "../../shared/history";

/** Closed UTC days rewritten from hourly rows on one cron. */
export const DIRTY_DAYS_PER_RUN = 2;

const DAY = DAY_MS;

export type HourlySample = {
  monitorId: string;
  hourStart: number;
  ok: number;
  fail: number;
  sum: number;
  max: number;
  maint: number;
};

export type DailyBucket = {
  monitorId: string;
  dayStart: number;
  ok: number;
  fail: number;
  sum: number;
  max: number;
  maint: number;
};

/**
 * Previous daily rollup. It summed every hourly row older than the current
 * UTC day and skipped the open day. The SQL path must match this oracle.
 */
export function aggregateClosedDays(
  rows: readonly HourlySample[],
  now: number,
): DailyBucket[] {
  const today = utcDayStart(now);
  const buckets = new Map<string, DailyBucket>();
  for (const row of rows) {
    if (row.hourStart >= today) continue;
    const dayStart = utcDayStart(row.hourStart);
    const key = `${row.monitorId}:${dayStart}`;
    const current = buckets.get(key) ?? {
      monitorId: row.monitorId,
      dayStart,
      ok: 0,
      fail: 0,
      sum: 0,
      max: 0,
      maint: 0,
    };
    current.ok += row.ok;
    current.fail += row.fail;
    current.sum += row.sum;
    current.max = Math.max(current.max, row.max);
    current.maint += row.maint;
    buckets.set(key, current);
  }
  return [...buckets.values()];
}

const UPSERT_DAILY = `INSERT INTO uptime_daily (
  monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max, maint_count
)
SELECT
  monitor_id,
  (hour_start / ${DAY}) * ${DAY} AS day_start,
  SUM(ok_count),
  SUM(fail_count),
  SUM(latency_sum),
  MAX(latency_max),
  SUM(COALESCE(maint_count, 0))
FROM uptime_hourly
WHERE hour_start >= ? AND hour_start < ?
GROUP BY monitor_id, (hour_start / ${DAY}) * ${DAY}
ON CONFLICT (monitor_id, day_start) DO UPDATE SET
  ok_count = excluded.ok_count,
  fail_count = excluded.fail_count,
  latency_sum = excluded.latency_sum,
  latency_max = excluded.latency_max,
  maint_count = excluded.maint_count`;

export async function rollDaily(
  database: D1Database,
  now = Date.now(),
): Promise<void> {
  const today = utcDayStart(now);
  const mark = await database
    .prepare("SELECT pending_before FROM rollup_watermark WHERE id = 1")
    .first<{ pending_before: number }>();
  let pending = mark?.pending_before ?? 0;

  if (pending !== -1) {
    if (pending === 0) {
      await database
        .prepare(
          `INSERT INTO rollup_dirty (monitor_id, day_start)
           SELECT DISTINCT monitor_id, ?
           FROM uptime_hourly
           WHERE hour_start >= ? AND hour_start < ?
           ON CONFLICT (monitor_id, day_start) DO NOTHING`,
        )
        .bind(today, today, today + DAY)
        .run();
      pending = today;
    }
    const newest = await database
      .prepare(
        `SELECT hour_start FROM uptime_hourly
         WHERE hour_start < ?
         ORDER BY hour_start DESC
         LIMIT 1`,
      )
      .bind(pending)
      .first<{ hour_start: number }>();
    if (!newest) {
      await writeWatermark(database, -1);
    } else {
      const day = utcDayStart(newest.hour_start);
      await database
        .prepare(UPSERT_DAILY)
        .bind(day, day + DAY)
        .run();
      await database
        .prepare(
          "DELETE FROM rollup_dirty WHERE day_start >= ? AND day_start < ?",
        )
        .bind(day, day + DAY)
        .run();
      await writeWatermark(database, day);
    }
  }

  const dirty = await database
    .prepare(
      `SELECT day_start FROM rollup_dirty
       WHERE day_start < ?
       GROUP BY day_start
       ORDER BY day_start DESC
       LIMIT ?`,
    )
    .bind(today, DIRTY_DAYS_PER_RUN)
    .all<{ day_start: number }>();
  const days = dirty.results.map((row) => row.day_start);
  if (days.length === 0) return;
  await recomputeDirtyDays(database, days);
  const marks = days.map(() => "?").join(", ");
  await database
    .prepare(`DELETE FROM rollup_dirty WHERE day_start IN (${marks})`)
    .bind(...days)
    .run();
}

async function writeWatermark(
  database: D1Database,
  pendingBefore: number,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO rollup_watermark (id, pending_before) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET pending_before = excluded.pending_before`,
    )
    .bind(pendingBefore)
    .run();
}

async function recomputeDirtyDays(
  database: D1Database,
  days: number[],
): Promise<void> {
  const marks = days.map(() => "?").join(", ");
  await database
    .prepare(
      `INSERT INTO uptime_daily (
         monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max, maint_count
       )
       SELECT
         h.monitor_id,
         d.day_start,
         SUM(h.ok_count),
         SUM(h.fail_count),
         SUM(h.latency_sum),
         MAX(h.latency_max),
         SUM(COALESCE(h.maint_count, 0))
       FROM rollup_dirty d
       INNER JOIN uptime_hourly h
         ON h.monitor_id = d.monitor_id
        AND h.hour_start >= d.day_start
        AND h.hour_start < d.day_start + ${DAY}
       WHERE d.day_start IN (${marks})
       GROUP BY h.monitor_id, d.day_start
       ON CONFLICT (monitor_id, day_start) DO UPDATE SET
         ok_count = excluded.ok_count,
         fail_count = excluded.fail_count,
         latency_sum = excluded.latency_sum,
         latency_max = excluded.latency_max,
         maint_count = excluded.maint_count`,
    )
    .bind(...days)
    .run();
}
