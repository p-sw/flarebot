// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DAY_MS, utcDayStart } from "../shared/history";
import { drainAnnouncements } from "../worker/announce/drain";
import { schedulerStub } from "../worker/monitors/sync";
import {
  FLUSH_ALARM_STATEMENTS,
  FREE_CRON_STATEMENT_BUDGET,
  openCronBudget,
  withDatabase,
} from "../worker/scheduler/budget";
import {
  aggregateClosedDays,
  type HourlySample,
} from "../worker/scheduler/daily";
import { mergeHourly, rollDaily } from "../worker/scheduler/persist";
import { initialState } from "../worker/scheduler/state-machine";
import { runScheduled } from "../worker/scheduler/watchdog";
import { instrumentD1 } from "./d1-count";

const HOUR = `INSERT INTO uptime_hourly (
  monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json, maint_count
) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`;

async function setWatermark(value: number) {
  await env.DB.prepare(
    "UPDATE rollup_watermark SET pending_before = ? WHERE id = 1",
  )
    .bind(value)
    .run();
}

async function insertHours(rows: HourlySample[]) {
  const statements = rows.map((row) =>
    env.DB.prepare(HOUR).bind(
      row.monitorId,
      row.hourStart,
      row.ok,
      row.fail,
      row.sum,
      row.max,
      row.maint,
    ),
  );
  for (let index = 0; index < statements.length; index += 40) {
    await env.DB.batch(statements.slice(index, index + 40));
  }
}

async function seedRetention(prefix: string, monitors: number, days: number) {
  const today = utcDayStart(Date.now());
  const rows: HourlySample[] = [];
  const ids: string[] = [];
  for (let monitor = 0; monitor < monitors; monitor += 1) {
    const id = `${prefix}-${monitor}`;
    ids.push(id);
    for (let day = 1; day <= days; day += 1) {
      rows.push({
        monitorId: id,
        hourStart: today - day * DAY_MS + 3_600_000,
        ok: day,
        fail: monitor,
        sum: day * 5,
        max: day + monitor,
        maint: day % 2,
      });
    }
  }
  await insertHours(rows);
  return ids;
}

async function dailyRows(ids: string[]) {
  const marks = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max, maint_count
     FROM uptime_daily WHERE monitor_id IN (${marks})
     ORDER BY monitor_id, day_start`,
  )
    .bind(...ids)
    .all<{
      monitor_id: string;
      day_start: number;
      ok_count: number;
      fail_count: number;
      latency_sum: number;
      latency_max: number;
      maint_count: number;
    }>();
  return result.results;
}

describe("free-plan D1 budget", () => {
  it("matches the previous full recompute and then only dirty days", async () => {
    const now = Date.UTC(2024, 8, 10, 15);
    const today = utcDayStart(now);
    const ids = ["eq-a", "eq-b", "eq-c"];
    const samples: HourlySample[] = [];
    for (const [index, id] of ids.entries()) {
      for (let day = 1; day <= 4; day += 1) {
        const dayStart = today - day * DAY_MS;
        samples.push({
          monitorId: id,
          hourStart: dayStart + 3_600_000,
          ok: day + index,
          fail: index,
          sum: day * 10 + index,
          max: 20 + day,
          maint: day === 2 ? 3 : 0,
        });
        samples.push({
          monitorId: id,
          hourStart: dayStart + 7_200_000,
          ok: 1,
          fail: day === 3 ? 2 : 0,
          sum: 4,
          max: 8 + index,
          maint: 1,
        });
      }
      samples.push({
        monitorId: id,
        hourStart: today + 3_600_000,
        ok: 50,
        fail: 50,
        sum: 50,
        max: 50,
        maint: 50,
      });
    }
    await insertHours(samples);
    await setWatermark(0);
    const expected = aggregateClosedDays(samples, now)
      .filter((row) => ids.includes(row.monitorId))
      .sort(
        (a, b) =>
          a.monitorId.localeCompare(b.monitorId) || a.dayStart - b.dayStart,
      );
    let actual = await dailyRows(ids);
    for (
      let step = 0;
      step < 80 && actual.length < expected.length;
      step += 1
    ) {
      await rollDaily(env.DB, now);
      actual = await dailyRows(ids);
    }
    expect(actual).toEqual(
      expected.map((row) => ({
        monitor_id: row.monitorId,
        day_start: row.dayStart,
        ok_count: row.ok,
        fail_count: row.fail,
        latency_sum: row.sum,
        latency_max: row.max,
        maint_count: row.maint,
      })),
    );
    const todayRow = await env.DB.prepare(
      "SELECT ok_count FROM uptime_daily WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(ids[0], today)
      .first();
    expect(todayRow).toBeNull();

    await setWatermark(-1);
    await env.DB.prepare(
      "UPDATE uptime_daily SET ok_count = 12345 WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(ids[2], today - 4 * DAY_MS)
      .run();
    const before = await dailyRows(ids);
    await mergeHourly(env.DB, ids[0], {
      hourStart: today - DAY_MS + 3_600_000,
      ok: 7,
      fail: 1,
      sum: 11,
      max: 6,
      samples: [6],
    });
    const meter = instrumentD1(env.DB);
    try {
      await rollDaily(env.DB, now);
      expect(meter.count()).toBeLessThanOrEqual(8);
    } finally {
      meter.restore();
    }
    const after = await dailyRows(ids);
    const changed = after.find(
      (row) => row.monitor_id === ids[0] && row.day_start === today - DAY_MS,
    );
    const previous = before.find(
      (row) => row.monitor_id === ids[0] && row.day_start === today - DAY_MS,
    );
    expect(changed?.ok_count).toBe((previous?.ok_count ?? 0) + 7);
    expect(changed?.fail_count).toBe((previous?.fail_count ?? 0) + 1);
    for (const row of before) {
      if (row.monitor_id === ids[0] && row.day_start === today - DAY_MS)
        continue;
      const same = after.find(
        (item) =>
          item.monitor_id === row.monitor_id &&
          item.day_start === row.day_start,
      );
      expect(same).toEqual(row);
    }
    const sentinel = after.find(
      (row) =>
        row.monitor_id === ids[2] && row.day_start === today - 4 * DAY_MS,
    );
    expect(sentinel?.ok_count).toBe(12345);
    await setWatermark(0);
  });

  it("keeps cron and rollup statements flat for 1, 10, and 36 monitors", async () => {
    const prefix = `budget-${crypto.randomUUID()}`;
    const counts: number[] = [];
    for (const monitors of [1, 10, 36]) {
      await seedRetention(`${prefix}-${monitors}`, monitors, 90);
      await env.DB.prepare("DELETE FROM rollup_dirty").run();
      await setWatermark(0);
      const meter = instrumentD1(env.DB);
      try {
        await rollDaily(env.DB, Date.now());
        counts.push(meter.count());
      } finally {
        meter.restore();
      }
    }
    expect(counts).toEqual([counts[0], counts[0], counts[0]]);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[0]).toBeLessThanOrEqual(12);
    expect(counts[2]).toBeLessThan(1 + 36 * 90);

    await env.DB.prepare(
      "DELETE FROM settings WHERE key = 'history_prune_state'",
    ).run();
    await setWatermark(0);
    const cron = instrumentD1(env.DB);
    try {
      const result = await runScheduled(env, FREE_CRON_STATEMENT_BUDGET);
      expect(cron.count()).toBeLessThanOrEqual(FREE_CRON_STATEMENT_BUDGET);
      expect(result.used).toBeLessThanOrEqual(FREE_CRON_STATEMENT_BUDGET);
      expect(result.used).toBe(cron.count());
    } finally {
      cron.restore();
    }
    await setWatermark(0);
  });

  it("flushes 1, 10, and 36 monitors in the same number of statements", async () => {
    const counts: number[] = [];
    for (const monitors of [1, 10, 36]) {
      const shardId = `flush-${monitors}-${crypto.randomUUID()}`;
      const ids: string[] = [];
      const now = Date.now();
      for (let index = 0; index < monitors; index += 1) {
        const id = `${shardId}-${index}`;
        ids.push(id);
        await env.DB.prepare(
          `INSERT INTO monitors (
            id, organization_id, name, type, config_json, interval_seconds,
            timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
            paused, created_at, updated_at
          ) VALUES (?, 'org-budget', ?, 'heartbeat', '{"graceSeconds":30}', 60, 10, 2, 1, '["default"]', ?, 0, ?, ?)`,
        )
          .bind(id, id, shardId, now, now)
          .run();
      }
      await seedRetention(shardId, monitors, 90);
      const stub = schedulerStub(env, shardId);
      for (const id of ids) {
        await stub.upsert({
          id,
          name: id,
          type: "heartbeat",
          intervalMs: 60_000,
          timeoutMs: 10_000,
          retries: 2,
          recoveryThreshold: 1,
          config: { graceSeconds: 30 },
          paused: false,
          nextCheckAt: now + 86_400_000,
          state: initialState(now),
          lastPushAt: null,
          regions: ["default"],
        });
        await stub.noteSample(id, {
          t: now,
          ok: true,
          ms: 12,
          internal: false,
        });
      }
      const meter = instrumentD1(env.DB);
      try {
        const ran = await stub.runDue(now);
        expect(ran.ran).toBe(0);
        counts.push(meter.count());
      } finally {
        meter.restore();
      }
      const hour = Math.floor(now / 3_600_000) * 3_600_000;
      const row = await env.DB.prepare(
        "SELECT ok_count FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?",
      )
        .bind(ids[0], hour)
        .first<{ ok_count: number }>();
      expect(row?.ok_count).toBe(1);
      await stub.runDue(now + 5 * 60_000);
      const again = await env.DB.prepare(
        "SELECT ok_count FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?",
      )
        .bind(ids[0], hour)
        .first<{ ok_count: number }>();
      expect(again?.ok_count).toBe(1);
    }
    expect(counts).toEqual([
      FLUSH_ALARM_STATEMENTS,
      FLUSH_ALARM_STATEMENTS,
      FLUSH_ALARM_STATEMENTS,
    ]);
    await setWatermark(0);
  });

  it("defers announcement rows instead of passing the statement cap", async () => {
    const now = Date.now();
    const ids: string[] = [];
    const eventIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = `budget-outbox-${crypto.randomUUID()}`;
      const eventId = `budget-event-${crypto.randomUUID()}`;
      ids.push(id);
      eventIds.push(eventId);
      await env.DB.prepare(
        `INSERT INTO announcement_events (
          id, organization_id, kind, subject_type, subject_id, title, summary, href, created_at
        ) VALUES (?, 'org-budget', 'incident.created', 'incident', ?, 'budget', '', NULL, ?)`,
      )
        .bind(eventId, id, now)
        .run();
      await env.DB.prepare(
        `INSERT INTO announcement_outbox (
          id, event_id, channel_id, status, attempts, next_attempt_at, created_at
        ) VALUES (?, ?, 'missing-channel', 'pending', 0, ?, ?)`,
      )
        .bind(id, eventId, now, now)
        .run();
    }
    const budget = openCronBudget(env.DB, 8);
    await drainAnnouncements(withDatabase(env, budget.database));
    expect(budget.used()).toBeLessThanOrEqual(8);
    expect(budget.deferred()).toBe(true);
    const marks = ids.map(() => "?").join(", ");
    const pending = await env.DB.prepare(
      `SELECT count(*) AS n FROM announcement_outbox
       WHERE id IN (${marks}) AND status = 'pending'`,
    )
      .bind(...ids)
      .first<{ n: number }>();
    const failed = await env.DB.prepare(
      `SELECT count(*) AS n FROM announcement_outbox
       WHERE id IN (${marks}) AND status = 'failed'`,
    )
      .bind(...ids)
      .first<{ n: number }>();
    expect(Number(pending?.n)).toBeGreaterThan(0);
    expect(Number(failed?.n)).toBeGreaterThan(0);
    expect(Number(pending?.n) + Number(failed?.n)).toBe(8);
    await env.DB.prepare(
      `DELETE FROM announcement_outbox WHERE id IN (${marks})`,
    )
      .bind(...ids)
      .run();
    const eventMarks = eventIds.map(() => "?").join(", ");
    await env.DB.prepare(
      `DELETE FROM announcement_events WHERE id IN (${eventMarks})`,
    )
      .bind(...eventIds)
      .run();
    await setWatermark(0);
  });
});
