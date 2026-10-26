// SPDX-License-Identifier: MIT

import { and, eq, isNull } from "drizzle-orm";
import { utcDayStart } from "../../shared/history";
import { getDb } from "../db/client";
import { certInfo, monitorState, outages } from "../db/schema";
import type { RuntimeState } from "./state-machine";

export { rollDaily } from "./daily";

type HourlyRollup = {
  hourStart: number;
  ok: number;
  fail: number;
  sum: number;
  max: number;
  samples: number[];
  maint?: number;
};

type HourlyRow = {
  ok_count: number;
  fail_count: number;
  latency_sum: number;
  latency_max: number;
  samples_json: string;
  maint_count: number | null;
};

const SELECT_HOURLY = `SELECT ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count
  FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?`;

const UPSERT_HOURLY = `INSERT INTO uptime_hourly (
  monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (monitor_id, hour_start) DO UPDATE SET
  ok_count = excluded.ok_count,
  fail_count = excluded.fail_count,
  latency_sum = excluded.latency_sum,
  latency_max = excluded.latency_max,
  samples_json = excluded.samples_json,
  maint_count = excluded.maint_count`;

const MARK_DIRTY = `INSERT INTO rollup_dirty (monitor_id, day_start) VALUES (?, ?)
ON CONFLICT (monitor_id, day_start) DO NOTHING`;

const UPSERT_STATE = `INSERT INTO monitor_state (
  monitor_id, status, since, last_response_ms, last_check_at,
  consecutive_failures, consecutive_successes, last_error, flapping
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (monitor_id) DO UPDATE SET
  status = excluded.status,
  since = excluded.since,
  last_response_ms = excluded.last_response_ms,
  last_check_at = excluded.last_check_at,
  consecutive_failures = excluded.consecutive_failures,
  consecutive_successes = excluded.consecutive_successes,
  last_error = excluded.last_error,
  flapping = excluded.flapping`;

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
  rollup: HourlyRollup,
): Promise<void> {
  const existing = await database
    .prepare(SELECT_HOURLY)
    .bind(monitorId, rollup.hourStart)
    .first<HourlyRow>();
  const merged = mergeHour(existing, rollup);
  await database.batch([
    database
      .prepare(UPSERT_HOURLY)
      .bind(
        monitorId,
        rollup.hourStart,
        merged.ok,
        merged.fail,
        merged.sum,
        merged.max,
        merged.samples,
        merged.maint,
      ),
    database.prepare(MARK_DIRTY).bind(monitorId, utcDayStart(rollup.hourStart)),
  ]);
}

export async function flushMonitorRollups(
  database: D1Database,
  entries: {
    monitorId: string;
    rollup: HourlyRollup;
    state: RuntimeState | null;
    markDirty: boolean;
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const existingRows = await database.batch<HourlyRow>(
    entries.map((entry) =>
      database
        .prepare(SELECT_HOURLY)
        .bind(entry.monitorId, entry.rollup.hourStart),
    ),
  );
  const writes: D1PreparedStatement[] = [];
  for (const [index, entry] of entries.entries()) {
    const merged = mergeHour(
      existingRows[index]?.results?.[0] ?? null,
      entry.rollup,
    );
    writes.push(
      database
        .prepare(UPSERT_HOURLY)
        .bind(
          entry.monitorId,
          entry.rollup.hourStart,
          merged.ok,
          merged.fail,
          merged.sum,
          merged.max,
          merged.samples,
          merged.maint,
        ),
    );
    if (entry.markDirty) {
      writes.push(
        database
          .prepare(MARK_DIRTY)
          .bind(entry.monitorId, utcDayStart(entry.rollup.hourStart)),
      );
    }
    if (entry.state) {
      writes.push(stateStatement(database, entry.monitorId, entry.state));
    }
  }
  await database.batch(writes);
}

function mergeHour(existing: HourlyRow | null, rollup: HourlyRollup) {
  const prior = existing?.samples_json
    ? (JSON.parse(existing.samples_json) as number[])
    : [];
  return {
    ok: (existing?.ok_count ?? 0) + rollup.ok,
    fail: (existing?.fail_count ?? 0) + rollup.fail,
    sum: (existing?.latency_sum ?? 0) + rollup.sum,
    max: Math.max(existing?.latency_max ?? 0, rollup.max),
    maint: (existing?.maint_count ?? 0) + (rollup.maint ?? 0),
    samples: JSON.stringify(prior.concat(rollup.samples).slice(-120)),
  };
}

function stateStatement(
  database: D1Database,
  monitorId: string,
  state: RuntimeState,
): D1PreparedStatement {
  return database
    .prepare(UPSERT_STATE)
    .bind(
      monitorId,
      state.status,
      state.statusSince,
      state.lastResponseMs,
      state.lastCheckAt,
      state.consecutiveFailures,
      state.consecutiveSuccesses,
      state.lastError,
      state.flappingNotified ? 1 : 0,
    );
}

export async function mergeSlot(
  database: D1Database,
  monitorId: string,
  slot: {
    slotStart: number;
    ok: number;
    fail: number;
    sum: number;
    max: number;
    maint?: number;
  },
): Promise<void> {
  const existing = await database
    .prepare(
      "SELECT ok_count, fail_count, latency_sum, latency_max, maint_count FROM uptime_slots WHERE monitor_id = ? AND slot_start = ?",
    )
    .bind(monitorId, slot.slotStart)
    .first<{
      ok_count: number;
      fail_count: number;
      latency_sum: number;
      latency_max: number;
      maint_count: number;
    }>();
  await database
    .prepare(
      `INSERT INTO uptime_slots (monitor_id, slot_start, ok_count, fail_count, latency_sum, latency_max, maint_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, slot_start) DO UPDATE SET
         ok_count = excluded.ok_count,
         fail_count = excluded.fail_count,
         latency_sum = excluded.latency_sum,
         latency_max = excluded.latency_max,
         maint_count = excluded.maint_count`,
    )
    .bind(
      monitorId,
      slot.slotStart,
      (existing?.ok_count ?? 0) + slot.ok,
      (existing?.fail_count ?? 0) + slot.fail,
      (existing?.latency_sum ?? 0) + slot.sum,
      Math.max(existing?.latency_max ?? 0, slot.max),
      (existing?.maint_count ?? 0) + (slot.maint ?? 0),
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
  await database.batch([
    database
      .prepare(UPSERT_HOURLY)
      .bind(
        monitorId,
        sample.hourStart,
        okCount,
        failCount,
        latencySum,
        latencyMax,
        JSON.stringify(trimmed),
        maintCount,
      ),
    database.prepare(MARK_DIRTY).bind(monitorId, utcDayStart(sample.hourStart)),
  ]);
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

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}
