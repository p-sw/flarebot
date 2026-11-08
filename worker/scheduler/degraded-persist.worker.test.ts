// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, SLOT_MS, utcDayStart } from "../../shared/history";
import { regionOfShard } from "../../shared/regions";
import { getDb } from "../db/client";
import { monitorState, monitors } from "../db/schema";
import { schedulerStub } from "../monitors/sync";
import {
  flushMonitorRollups,
  rollDaily,
  runtimeFromRow,
  saveRuntime,
} from "./persist";
import { relocateMonitor } from "./placement";
import { initialState, type RuntimeState } from "./state-machine";

const created: { id: string; shard: () => Promise<string> }[] = [];

afterEach(async () => {
  for (const entry of created.splice(0)) {
    await schedulerStub(env, await entry.shard())
      .remove(entry.id)
      .catch(() => undefined);
    await env.DB.prepare("DELETE FROM monitors WHERE id = ?")
      .bind(entry.id)
      .run();
  }
});

async function insertMonitor(
  id: string,
  shardId: string,
  regionsJson = '["default"]',
): Promise<void> {
  const now = Date.now();
  created.push({
    id,
    shard: async () =>
      (
        await env.DB.prepare("SELECT shard_id FROM monitors WHERE id = ?")
          .bind(id)
          .first<{ shard_id: string }>()
      )?.shard_id ?? shardId,
  });
  await env.DB.prepare(
    `INSERT INTO monitors (
      id, organization_id, name, type, config_json, interval_seconds,
      timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
      paused, created_at, updated_at
    ) VALUES (?, 'org-degraded-persist', ?, 'heartbeat', '{"graceSeconds":30}', 60, 10, 2, 1, ?, ?, 0, ?, ?)`,
  )
    .bind(id, id, regionsJson, shardId, now, now)
    .run();
}

function degradedState(now: number, notified: boolean): RuntimeState {
  return {
    ...initialState(now),
    status: "degraded",
    consecutiveSuccesses: 4,
    lastResponseMs: 900,
    lastCheckAt: now,
    degradedNotified: notified,
  };
}

async function storedRow(id: string) {
  return getDb(env.DB)
    .select()
    .from(monitorState)
    .where(eq(monitorState.monitorId, id))
    .get();
}

async function flagOf(id: string) {
  return (
    await env.DB.prepare(
      "SELECT degraded_notified AS flag FROM monitor_state WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{ flag: number }>()
  )?.flag;
}

describe("degraded_notified in D1", () => {
  it.each([
    [true, 1],
    [false, 0],
    [undefined, 0],
  ])("saveRuntime stores degradedNotified=%s as %i", async (notified, flag) => {
    const id = crypto.randomUUID();
    await insertMonitor(id, `persist-${id}`);
    await saveRuntime(env.DB, id, {
      ...degradedState(Date.now(), false),
      degradedNotified: notified,
    });
    expect(await flagOf(id)).toBe(flag);
  });

  it("saveRuntime overwrites the flag on the update path", async () => {
    const id = crypto.randomUUID();
    await insertMonitor(id, `persist-${id}`);
    const now = Date.now();
    await saveRuntime(env.DB, id, degradedState(now, true));
    expect(await flagOf(id)).toBe(1);
    await saveRuntime(env.DB, id, {
      ...degradedState(now, false),
      status: "up",
    });
    expect(await flagOf(id)).toBe(0);
  });

  it("reads the flag back exactly as saveRuntime stored it", async () => {
    const id = crypto.randomUUID();
    await insertMonitor(id, `persist-${id}`);
    const now = Date.now();
    const state = { ...degradedState(now, true), lastError: null };
    await saveRuntime(env.DB, id, state);
    expect(runtimeFromRow(await storedRow(id), now + 1)).toEqual({
      ...state,
      transitions: [],
    });
  });

  it.each([true, false])(
    "runtimeFromRow keeps degradedNotified=%s from the row",
    (notified) => {
      const state = runtimeFromRow(
        {
          monitorId: "m",
          status: "degraded",
          since: 10,
          lastResponseMs: 900,
          lastCheckAt: 20,
          consecutiveFailures: 0,
          consecutiveSuccesses: 3,
          lastError: null,
          flapping: false,
          degradedNotified: notified,
        },
        99,
      );
      expect(state.degradedNotified).toBe(notified);
      expect(state.status).toBe("degraded");
      expect(state.statusSince).toBe(10);
    },
  );

  it("runtimeFromRow starts fresh without a row", () => {
    expect(runtimeFromRow(undefined, 1234)).toEqual(initialState(1234));
  });

  it("reads an existing row written before migration 0010 as not notified", async () => {
    const id = crypto.randomUUID();
    await insertMonitor(id, `persist-${id}`);
    await env.DB.prepare(
      `INSERT INTO monitor_state (
        monitor_id, status, since, last_response_ms, last_check_at,
        consecutive_failures, consecutive_successes, last_error, flapping
      ) VALUES (?, 'up', 1, 40, 1, 0, 3, NULL, 0)`,
    )
      .bind(id)
      .run();
    expect(await flagOf(id)).toBe(0);
    expect(runtimeFromRow(await storedRow(id), 2).degradedNotified).toBe(false);
  });

  it("the periodic flush writes the flag with the rest of the state", async () => {
    const id = crypto.randomUUID();
    await insertMonitor(id, `persist-${id}`);
    const hourStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const rollup = {
      hourStart,
      ok: 2,
      fail: 0,
      sum: 80,
      max: 50,
      samples: [30, 50],
      maint: 0,
      deg: 1,
    };
    await flushMonitorRollups(env.DB, [
      {
        monitorId: id,
        rollup,
        state: degradedState(hourStart, true),
        markDirty: true,
      },
    ]);
    expect(await flagOf(id)).toBe(1);
    await flushMonitorRollups(env.DB, [
      {
        monitorId: id,
        rollup: { ...rollup, deg: 2 },
        state: { ...degradedState(hourStart, false), status: "up" },
        markDirty: false,
      },
    ]);
    expect(await flagOf(id)).toBe(0);
    const hourly = await env.DB.prepare(
      "SELECT ok_count, degraded_count FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?",
    )
      .bind(id, hourStart)
      .first<{ ok_count: number; degraded_count: number }>();
    expect(hourly).toEqual({ ok_count: 4, degraded_count: 3 });
  });

  it("the shard flush stores a flag that no transition saved", async () => {
    const id = crypto.randomUUID();
    const shardId = `persist-flush-${id}`;
    await insertMonitor(id, shardId);
    const now = Date.now();
    // D1 still holds an old row without the flag.
    await saveRuntime(env.DB, id, {
      ...degradedState(now, false),
      status: "up",
    });
    const stub = schedulerStub(env, shardId);
    const due = now + 3_600_000;
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
      nextCheckAt: due,
      state: degradedState(now, true),
      lastPushAt: null,
      regions: ["default"],
    });
    // A missed heartbeat moves degraded to pending. Pending is not saved on
    // its own; the flush that follows the first check writes it.
    await stub.runDue(due);
    expect((await stub.getOne(id))?.state.status).toBe("pending");
    const row = await storedRow(id);
    expect(row?.status).toBe("pending");
    expect(row?.degradedNotified).toBe(true);
  });

  it("detach saves the flag before the monitor leaves the shard", async () => {
    const id = crypto.randomUUID();
    const shardId = `persist-detach-${id}`;
    await insertMonitor(id, shardId);
    const now = Date.now();
    const stub = schedulerStub(env, shardId);
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
      nextCheckAt: now + 3_600_000,
      state: degradedState(now, true),
      lastPushAt: null,
      regions: ["default"],
    });
    const detached = await stub.detach(id);
    expect(detached?.state.degradedNotified).toBe(true);
    expect(await flagOf(id)).toBe(1);
  });

  it("a move whose detach found nothing reloads the flag from D1", async () => {
    const id = crypto.randomUUID();
    const source = `oc-${860_000 + Math.floor(Math.random() * 10_000)}`;
    await insertMonitor(id, source, '["apac"]');
    const now = Date.now();
    await saveRuntime(env.DB, id, degradedState(now, true));
    const row = await getDb(env.DB)
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!row) throw new Error("missing monitor");
    // The source shard never held the monitor, so detach returns null and
    // relocateMonitor falls back to loadRuntime.
    expect(await schedulerStub(env, source).detach(id)).toBeNull();
    const destination = await relocateMonitor(env, row, "auto");
    expect(regionOfShard(destination)).toBe("apac");
    const landed = await schedulerStub(env, destination).getOne(id);
    expect(landed?.state.status).toBe("degraded");
    expect(landed?.state.degradedNotified).toBe(true);
  });

  it("a move whose detach found nothing keeps a cleared flag cleared", async () => {
    const id = crypto.randomUUID();
    const source = `oc-${870_000 + Math.floor(Math.random() * 10_000)}`;
    await insertMonitor(id, source, '["apac"]');
    await saveRuntime(env.DB, id, degradedState(Date.now(), false));
    const row = await getDb(env.DB)
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!row) throw new Error("missing monitor");
    const destination = await relocateMonitor(env, row, "auto");
    const landed = await schedulerStub(env, destination).getOne(id);
    expect(landed?.state.degradedNotified).toBe(false);
  });
});

describe("degraded counts in rollups", () => {
  async function seeded(prefix: string) {
    const id = crypto.randomUUID();
    const shardId = `${prefix}-${id}`;
    await insertMonitor(id, shardId);
    const stub = schedulerStub(env, shardId);
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
      nextCheckAt: Date.now() + 3_600_000,
      state: initialState(Date.now()),
      lastPushAt: null,
      regions: ["default"],
    });
    return { id, stub };
  }

  it("counts only successful, non-internal degraded samples on the slot", async () => {
    const { id, stub } = await seeded("deg-slot");
    const slot = Math.floor(Date.now() / SLOT_MS) * SLOT_MS;
    const sample = { ms: 20, internal: false };
    await stub.noteSample(id, {
      ...sample,
      t: slot + 1_000,
      ok: true,
      degraded: true,
    });
    await stub.noteSample(id, {
      ...sample,
      t: slot + 2_000,
      ok: true,
      degraded: false,
    });
    await stub.noteSample(id, {
      ...sample,
      t: slot + 3_000,
      ok: false,
      degraded: true,
    });
    await stub.noteSample(id, {
      ...sample,
      t: slot + 4_000,
      ok: true,
      internal: true,
      degraded: true,
    });
    const open = await stub.getOne(id);
    expect(open?.slot).toMatchObject({ ok: 2, fail: 1, deg: 1 });
    expect(open?.recent.map((point) => point.deg ?? false)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    await stub.noteSample(id, {
      ...sample,
      t: slot + SLOT_MS + 1_000,
      ok: true,
    });
    const row = await env.DB.prepare(
      `SELECT ok_count, fail_count, degraded_count
       FROM uptime_slots WHERE monitor_id = ? AND slot_start = ?`,
    )
      .bind(id, slot)
      .first<{
        ok_count: number;
        fail_count: number;
        degraded_count: number;
      }>();
    expect(row).toEqual({ ok_count: 2, fail_count: 1, degraded_count: 1 });
  });

  it("writes the hour's degraded count when the hour closes and keeps it in ok", async () => {
    const { id, stub } = await seeded("deg-hour");
    const hour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    for (const [offset, degraded] of [
      [1_000, true],
      [2_000, true],
      [3_000, false],
    ] as const) {
      await stub.noteSample(id, {
        t: hour + offset,
        ok: true,
        ms: 10,
        internal: false,
        degraded,
      });
    }
    await stub.noteSample(id, {
      t: hour + HOUR_MS + 1_000,
      ok: true,
      ms: 10,
      internal: false,
    });
    const row = await env.DB.prepare(
      `SELECT ok_count, fail_count, degraded_count
       FROM uptime_hourly WHERE monitor_id = ? AND hour_start = ?`,
    )
      .bind(id, hour)
      .first<{
        ok_count: number;
        fail_count: number;
        degraded_count: number;
      }>();
    expect(row).toEqual({ ok_count: 3, fail_count: 0, degraded_count: 2 });
  });

  it("does not count a degraded sample inside maintenance", async () => {
    const { id, stub } = await seeded("deg-maint");
    const now = Date.now();
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const windowId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO maintenance_windows (
        id, organization_id, title, description, timezone, start_at, end_at,
        recurrence, weekdays_json, notify, created_at, updated_at
      ) VALUES (?, 'org-degraded-persist', 'Window', '', 'UTC', ?, ?, 'once', '[]', 0, ?, ?)`,
    )
      .bind(windowId, slot, slot + SLOT_MS, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)",
    )
      .bind(windowId, id)
      .run();
    await stub.noteSample(id, {
      t: slot + 1_000,
      ok: true,
      ms: 10,
      internal: false,
      degraded: true,
    });
    expect((await stub.getOne(id))?.slot).toMatchObject({
      ok: 0,
      maint: 1,
      deg: 0,
    });
  });
});

describe("degraded counts in daily rollups", () => {
  async function watermark(): Promise<number | null> {
    return (
      (
        await env.DB.prepare(
          "SELECT pending_before FROM rollup_watermark WHERE id = 1",
        ).first<{ pending_before: number }>()
      )?.pending_before ?? null
    );
  }

  async function setWatermark(value: number | null) {
    if (value === null) {
      await env.DB.prepare("DELETE FROM rollup_watermark WHERE id = 1").run();
      return;
    }
    await env.DB.prepare(
      `INSERT INTO rollup_watermark (id, pending_before) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET pending_before = excluded.pending_before`,
    )
      .bind(value)
      .run();
  }

  async function insertHour(
    id: string,
    hourStart: number,
    ok: number,
    degraded: number,
  ) {
    await env.DB.prepare(
      `INSERT INTO uptime_hourly (
        monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max,
        samples_json, maint_count, degraded_count
      ) VALUES (?, ?, ?, 1, 100, 50, '[]', 0, ?)`,
    )
      .bind(id, hourStart, ok, degraded)
      .run();
  }

  async function daily(id: string, day: number) {
    return env.DB.prepare(
      "SELECT ok_count, fail_count, degraded_count FROM uptime_daily WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(id, day)
      .first<{
        ok_count: number;
        fail_count: number;
        degraded_count: number;
      }>();
  }

  it("sums degraded counts on the backfill pass", async () => {
    const before = await watermark();
    try {
      const id = crypto.randomUUID();
      await insertMonitor(id, `daily-${id}`);
      const now = Date.now();
      const day = utcDayStart(now) - DAY_MS;
      await insertHour(id, day + HOUR_MS, 10, 2);
      await insertHour(id, day + 5 * HOUR_MS, 20, 3);
      await setWatermark(0);
      for (let step = 0; step < 80 && !(await daily(id, day)); step += 1) {
        await rollDaily(env.DB, now);
      }
      expect(await daily(id, day)).toEqual({
        ok_count: 30,
        fail_count: 2,
        degraded_count: 5,
      });
    } finally {
      await setWatermark(before);
    }
  });

  it("recomputes degraded counts for a dirty day", async () => {
    const before = await watermark();
    try {
      const id = crypto.randomUUID();
      await insertMonitor(id, `daily-dirty-${id}`);
      const now = Date.now();
      const day = utcDayStart(now) - DAY_MS;
      await setWatermark(-1);
      await insertHour(id, day + 2 * HOUR_MS, 7, 1);
      await env.DB.prepare(
        "INSERT INTO rollup_dirty (monitor_id, day_start) VALUES (?, ?) ON CONFLICT DO NOTHING",
      )
        .bind(id, day)
        .run();
      await rollDaily(env.DB, now);
      expect(await daily(id, day)).toEqual({
        ok_count: 7,
        fail_count: 1,
        degraded_count: 1,
      });
      await env.DB.prepare(
        "UPDATE uptime_hourly SET ok_count = 9, degraded_count = 4 WHERE monitor_id = ?",
      )
        .bind(id)
        .run();
      await env.DB.prepare(
        "INSERT INTO rollup_dirty (monitor_id, day_start) VALUES (?, ?) ON CONFLICT DO NOTHING",
      )
        .bind(id, day)
        .run();
      await rollDaily(env.DB, now);
      expect(await daily(id, day)).toEqual({
        ok_count: 9,
        fail_count: 1,
        degraded_count: 4,
      });
    } finally {
      await setWatermark(before);
    }
  });

  it("reads hourly rows written before migration 0010 as zero degraded", async () => {
    const before = await watermark();
    try {
      const id = crypto.randomUUID();
      await insertMonitor(id, `daily-old-${id}`);
      const now = Date.now();
      const day = utcDayStart(now) - DAY_MS;
      await setWatermark(-1);
      await env.DB.prepare(
        `INSERT INTO uptime_hourly (
          monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
        ) VALUES (?, ?, 5, 0, 50, 20, '[]')`,
      )
        .bind(id, day + HOUR_MS)
        .run();
      await env.DB.prepare(
        "INSERT INTO rollup_dirty (monitor_id, day_start) VALUES (?, ?) ON CONFLICT DO NOTHING",
      )
        .bind(id, day)
        .run();
      await rollDaily(env.DB, now);
      expect((await daily(id, day))?.degraded_count).toBe(0);
    } finally {
      await setWatermark(before);
    }
  });
});
