// SPDX-License-Identifier: MIT

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  certInfo,
  monitorState,
  outages,
  uptimeDaily,
  uptimeHourly,
} from "../db/schema";
import type { RuntimeState } from "./state-machine";

export async function saveRuntime(
  database: D1Database,
  monitorId: string,
  state: RuntimeState,
): Promise<void> {
  const db = getDb(database);
  await db
    .insert(monitorState)
    .values({
      monitorId,
      status: state.status,
      since: state.statusSince,
      lastResponseMs: state.lastResponseMs,
      lastCheckAt: state.lastCheckAt,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveSuccesses: state.consecutiveSuccesses,
      lastError: state.lastError,
      flapping: state.flappingNotified,
    })
    .onConflictDoUpdate({
      target: monitorState.monitorId,
      set: {
        status: state.status,
        since: state.statusSince,
        lastResponseMs: state.lastResponseMs,
        lastCheckAt: state.lastCheckAt,
        consecutiveFailures: state.consecutiveFailures,
        consecutiveSuccesses: state.consecutiveSuccesses,
        lastError: state.lastError,
        flapping: state.flappingNotified,
      },
    });
}

export async function openOutage(
  database: D1Database,
  monitorId: string,
  cause: string,
  at: number,
): Promise<void> {
  const db = getDb(database);
  await db.insert(outages).values({
    id: crypto.randomUUID(),
    monitorId,
    startedAt: at,
    endedAt: null,
    cause,
    acknowledgedBy: null,
    acknowledgedAt: null,
  });
}

export async function closeOutage(
  database: D1Database,
  monitorId: string,
  at: number,
): Promise<void> {
  const db = getDb(database);
  const open = await db
    .select()
    .from(outages)
    .where(and(eq(outages.monitorId, monitorId), isNull(outages.endedAt)))
    .get();
  if (!open) return;
  await db.update(outages).set({ endedAt: at }).where(eq(outages.id, open.id));
}

export async function mergeHourly(
  database: D1Database,
  monitorId: string,
  rollup: {
    hourStart: number;
    ok: number;
    fail: number;
    sum: number;
    max: number;
    samples: number[];
    maint?: number;
  },
): Promise<void> {
  const existing = await database
    .prepare(
      "SELECT ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?",
    )
    .bind(monitorId, rollup.hourStart)
    .first<{
      ok_count: number;
      fail_count: number;
      latency_sum: number;
      latency_max: number;
      samples_json: string;
      maint_count: number;
    }>();
  const samples = existing
    ? (JSON.parse(existing.samples_json) as number[]).concat(rollup.samples)
    : rollup.samples;
  await database
    .prepare(
      `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, hour_start) DO UPDATE SET
         ok_count = excluded.ok_count,
         fail_count = excluded.fail_count,
         latency_sum = excluded.latency_sum,
         latency_max = excluded.latency_max,
         samples_json = excluded.samples_json,
         maint_count = excluded.maint_count`,
    )
    .bind(
      monitorId,
      rollup.hourStart,
      (existing?.ok_count ?? 0) + rollup.ok,
      (existing?.fail_count ?? 0) + rollup.fail,
      (existing?.latency_sum ?? 0) + rollup.sum,
      Math.max(existing?.latency_max ?? 0, rollup.max),
      JSON.stringify(samples.slice(-120)),
      (existing?.maint_count ?? 0) + (rollup.maint ?? 0),
    )
    .run();
}

export async function addHourly(
  database: D1Database,
  monitorId: string,
  sample: { hourStart: number; ok: boolean; ms: number; maintenance?: boolean },
): Promise<void> {
  const existing = await database
    .prepare(
      "SELECT ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?",
    )
    .bind(monitorId, sample.hourStart)
    .first<{
      ok_count: number;
      fail_count: number;
      latency_sum: number;
      latency_max: number;
      samples_json: string;
      maint_count: number;
    }>();
  const samples = existing
    ? (JSON.parse(existing.samples_json) as number[])
    : [];
  const maintenance = sample.maintenance === true;
  if (!maintenance) samples.push(sample.ms);
  const trimmed = samples.slice(-120);
  const okCount =
    (existing?.ok_count ?? 0) + (!maintenance && sample.ok ? 1 : 0);
  const failCount =
    (existing?.fail_count ?? 0) + (!maintenance && !sample.ok ? 1 : 0);
  const latencySum =
    (existing?.latency_sum ?? 0) + (maintenance ? 0 : sample.ms);
  const latencyMax = maintenance
    ? (existing?.latency_max ?? 0)
    : Math.max(existing?.latency_max ?? 0, sample.ms);
  const maintCount = (existing?.maint_count ?? 0) + (maintenance ? 1 : 0);
  await database
    .prepare(
      `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, hour_start) DO UPDATE SET
         ok_count = excluded.ok_count,
         fail_count = excluded.fail_count,
         latency_sum = excluded.latency_sum,
         latency_max = excluded.latency_max,
         samples_json = excluded.samples_json,
         maint_count = excluded.maint_count`,
    )
    .bind(
      monitorId,
      sample.hourStart,
      okCount,
      failCount,
      latencySum,
      latencyMax,
      JSON.stringify(trimmed),
      maintCount,
    )
    .run();
}

export async function saveCert(
  database: D1Database,
  monitorId: string,
  notAfter: number | null,
  error: string | null,
): Promise<void> {
  const db = getDb(database);
  await db
    .insert(certInfo)
    .values({
      monitorId,
      notAfter,
      lastCheckedAt: Date.now(),
      source: "ct-log",
      error,
    })
    .onConflictDoUpdate({
      target: certInfo.monitorId,
      set: { notAfter, lastCheckedAt: Date.now(), source: "ct-log", error },
    });
}

export async function rollDaily(
  database: D1Database,
  now = Date.now(),
): Promise<void> {
  const db = getDb(database);
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const rows = await db
    .select({
      monitorId: uptimeHourly.monitorId,
      hourStart: uptimeHourly.hourStart,
      okCount: uptimeHourly.okCount,
      failCount: uptimeHourly.failCount,
      latencySum: uptimeHourly.latencySum,
      latencyMax: uptimeHourly.latencyMax,
      maintCount: uptimeHourly.maintCount,
    })
    .from(uptimeHourly)
    .where(sql`${uptimeHourly.hourStart} < ${today}`);
  const buckets = new Map<
    string,
    {
      monitorId: string;
      dayStart: number;
      ok: number;
      fail: number;
      sum: number;
      max: number;
      maint: number;
    }
  >();
  for (const row of rows) {
    const dayStart = Date.UTC(
      new Date(row.hourStart).getUTCFullYear(),
      new Date(row.hourStart).getUTCMonth(),
      new Date(row.hourStart).getUTCDate(),
    );
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
    current.ok += row.okCount;
    current.fail += row.failCount;
    current.sum += row.latencySum;
    current.max = Math.max(current.max, row.latencyMax);
    current.maint += row.maintCount;
    buckets.set(key, current);
  }
  for (const bucket of buckets.values()) {
    await db
      .insert(uptimeDaily)
      .values({
        monitorId: bucket.monitorId,
        dayStart: bucket.dayStart,
        okCount: bucket.ok,
        failCount: bucket.fail,
        latencySum: bucket.sum,
        latencyMax: bucket.max,
        maintCount: bucket.maint,
      })
      .onConflictDoUpdate({
        target: [uptimeDaily.monitorId, uptimeDaily.dayStart],
        set: {
          okCount: bucket.ok,
          failCount: bucket.fail,
          latencySum: bucket.sum,
          latencyMax: bucket.max,
          maintCount: bucket.maint,
        },
      });
  }
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}
