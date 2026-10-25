// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { assignShard, schedulerStub } from "../monitors/sync";
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
    const yesterday = Date.UTC(2020, 0, 2);
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
});
