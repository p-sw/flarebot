// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HISTORY_RETENTION_KEY,
  SLOT_MS,
  utcDayStart,
} from "../../shared/history";
import { assignShard, schedulerStub } from "../monitors/sync";
import { writeSetting } from "../settings-store";
import { shardCapacity } from "./capacity";
import { initialState } from "./state-machine";
import { watchdog } from "./watchdog";

async function insertMonitor(id: string, shardId: string) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO monitors (
      id, organization_id, name, type, config_json, interval_seconds,
      timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
      paused, created_at, updated_at
    ) VALUES (?, ?, ?, 'heartbeat', '{"graceSeconds":30}', 60, 10, 2, 1, '["default"]', ?, 0, ?, ?)`,
  )
    .bind(id, "org-shard", id, shardId, now, now)
    .run();
}

describe("scheduler shard", () => {
  it("reschedules the alarm after a pending check and confirms down", async () => {
    const id = crypto.randomUUID();
    const shardId = `sched-${id}`;
    await insertMonitor(id, shardId);
    const stub = schedulerStub(env, shardId);
    const now = Date.now();
    const dueAt = now + 30_000;
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
      nextCheckAt: dueAt,
      state: initialState(now),
      lastPushAt: null,
      regions: ["default"],
    });
    expect(await stub.alarmAt()).toBe(dueAt);
    const first = await stub.runDue(dueAt);
    expect(first.ran).toBe(1);
    const pending = await stub.getOne(id);
    expect(pending?.state.status).toBe("pending");
    expect(pending?.nextCheckAt).toBe(dueAt + 10_000);
    expect(await stub.alarmAt()).toBe(dueAt + 10_000);

    const early = await stub.runDue(dueAt + 1_000);
    expect(early.ran).toBe(0);

    const second = await stub.runDue(dueAt + 10_000);
    expect(second.ran).toBe(1);
    expect((await stub.getOne(id))?.state.status).toBe("down");
    const outage = await env.DB.prepare(
      "SELECT ended_at FROM outages WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{ ended_at: number | null }>();
    expect(outage?.ended_at).toBeNull();

    await stub.recordPush(id, dueAt + 11_000);
    await stub.runDue(dueAt + 12_000);
    expect((await stub.getOne(id))?.state.status).toBe("up");
    const closed = await env.DB.prepare(
      "SELECT ended_at FROM outages WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{ ended_at: number | null }>();
    expect(closed?.ended_at).not.toBeNull();
  });

  it("opens a new shard once the current one is full", async () => {
    const capacity = shardCapacity(60, 10);
    const shardId = `full-${crypto.randomUUID()}`;
    for (let index = 0; index < capacity; index += 1) {
      await insertMonitor(`${shardId}-${index}`, shardId);
    }
    const next = await assignShard(env, 60, 10);
    expect(next).not.toBe(shardId);
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM monitors WHERE shard_id = ?",
    )
      .bind(shardId)
      .first<{ n: number }>();
    expect(count?.n).toBe(capacity);
  });

  it("repairs a missing alarm and rolls yesterday into a daily bucket", async () => {
    const id = crypto.randomUUID();
    const shardId = `repair-${id}`;
    await insertMonitor(id, shardId);
    const stub = schedulerStub(env, shardId);
    expect(await stub.alarmAt()).toBeNull();
    await writeSetting(env, HISTORY_RETENTION_KEY, 90);
    const yesterday = utcDayStart(Date.now()) - DAY_MS;
    await env.DB.prepare(
      `INSERT INTO uptime_hourly (
        monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
      ) VALUES (?, ?, 3, 1, 120, 80, '[]')`,
    )
      .bind(id, yesterday)
      .run();
    const old = Date.now() - 15 * 86_400_000;
    await env.DB.prepare(
      `INSERT INTO mail_outbox (
        id, kind, to_address, subject, text_body, status, attempts,
        next_attempt_at, message_id, created_at, sent_at
      ) VALUES (?, 'alert', 'a@example.com', 'old', 'old', 'sent', 1, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), old, "<old@flarebot.local>", old, old)
      .run();
    await watchdog(env);
    expect(await stub.alarmAt()).not.toBeNull();
    const daily = await env.DB.prepare(
      "SELECT ok_count, fail_count FROM uptime_daily WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(id, yesterday)
      .first<{ ok_count: number; fail_count: number }>();
    expect(daily).toEqual({ ok_count: 3, fail_count: 1 });
    const kept = await env.DB.prepare(
      "SELECT count(*) AS n FROM mail_outbox WHERE subject = 'old'",
    ).first<{ n: number }>();
    expect(kept?.n).toBe(0);
  });

  it("writes a slot when the 15 minute bucket closes", async () => {
    const id = crypto.randomUUID();
    const shardId = `slot-${id}`;
    await insertMonitor(id, shardId);
    const stub = schedulerStub(env, shardId);
    const now = Date.now();
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
      nextCheckAt: now + 60_000,
      state: initialState(now),
      lastPushAt: null,
      regions: ["default"],
    });
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    await stub.noteSample(id, {
      t: slot + 1000,
      ok: true,
      ms: 20,
      internal: false,
    });
    await stub.noteSample(id, {
      t: slot + SLOT_MS + 1000,
      ok: false,
      ms: 40,
      internal: false,
    });
    const row = await env.DB.prepare(
      `SELECT ok_count, fail_count, latency_sum
       FROM uptime_slots WHERE monitor_id = ? AND slot_start = ?`,
    )
      .bind(id, slot)
      .first<{ ok_count: number; fail_count: number; latency_sum: number }>();
    expect(row).toEqual({ ok_count: 1, fail_count: 0, latency_sum: 20 });
    expect((await stub.getOne(id))?.slot).toEqual({
      slotStart: slot + SLOT_MS,
      ok: 0,
      fail: 1,
      sum: 40,
      max: 40,
      maint: 0,
    });
  });

  it("counts a maintenance sample on the slot and leaves it out of uptime", async () => {
    const id = crypto.randomUUID();
    const shardId = `slot-maint-${id}`;
    await insertMonitor(id, shardId);
    const now = Date.now();
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const windowId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO maintenance_windows (
        id, organization_id, title, description, timezone, start_at, end_at,
        recurrence, weekdays_json, notify, created_at, updated_at
      ) VALUES (?, 'org-shard', 'Window', '', 'UTC', ?, ?, 'once', '[]', 0, ?, ?)`,
    )
      .bind(windowId, slot, slot + SLOT_MS, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)",
    )
      .bind(windowId, id)
      .run();
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
      nextCheckAt: now + 60_000,
      state: initialState(now),
      lastPushAt: null,
      regions: ["default"],
    });
    await stub.noteSample(id, {
      t: slot + 1000,
      ok: false,
      ms: 80,
      internal: false,
    });
    await stub.noteSample(id, {
      t: slot + SLOT_MS + 1000,
      ok: true,
      ms: 10,
      internal: false,
    });
    const row = await env.DB.prepare(
      `SELECT ok_count, fail_count, latency_sum, maint_count
       FROM uptime_slots WHERE monitor_id = ? AND slot_start = ?`,
    )
      .bind(id, slot)
      .first<{
        ok_count: number;
        fail_count: number;
        latency_sum: number;
        maint_count: number;
      }>();
    expect(row).toEqual({
      ok_count: 0,
      fail_count: 0,
      latency_sum: 0,
      maint_count: 1,
    });
    expect((await stub.getOne(id))?.slot).toEqual({
      slotStart: slot + SLOT_MS,
      ok: 1,
      fail: 0,
      sum: 10,
      max: 10,
      maint: 0,
    });
  });
});
