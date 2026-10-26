// SPDX-License-Identifier: MIT

import { sql } from "drizzle-orm";
import {
  type CheckRegionId,
  effectiveRegion,
  locationHintForShard,
  regionOfShard,
  shardIndex,
  shardName,
  storedRegion,
} from "../../shared/regions";
import type { MonitorType } from "../../shared/schemas";
import { parseMonitorConfig } from "../../shared/schemas";
import { readCheckRegion } from "../check-region";
import { runCheck } from "../checks/run";
import {
  decryptString,
  encryptString,
  randomToken,
  sha256Hex,
} from "../crypto/secret";
import { getDb } from "../db/client";
import { monitors } from "../db/schema";
import { shardCapacity } from "../scheduler/capacity";
import { openOutage, saveRuntime } from "../scheduler/persist";
import type { Snapshot } from "../scheduler/shard";
import {
  applyOutcome,
  initialState,
  type RuntimeState,
} from "../scheduler/state-machine";

export type SchedulerApi = {
  upsert(snapshot: Snapshot): Promise<void>;
  remove(id: string): Promise<void>;
  recordPush(id: string, at: number): Promise<boolean>;
  getAll(): Promise<
    {
      id: string;
      state: RuntimeState;
      recent: { t: number; ok: boolean; ms: number; maint?: boolean }[];
      nextCheckAt: number;
      lastPushAt: number | null;
      rollup: {
        hourStart: number;
        ok: number;
        fail: number;
        maint: number;
        sum: number;
        max: number;
        samples: number[];
      } | null;
      slot: {
        slotStart: number;
        ok: number;
        fail: number;
        sum: number;
        max: number;
        maint: number;
      } | null;
    }[]
  >;
  getOne(id: string): Promise<{
    state: RuntimeState;
    recent: { t: number; ok: boolean; ms: number; maint?: boolean }[];
    nextCheckAt: number;
    lastPushAt: number | null;
    rollup: {
      hourStart: number;
      ok: number;
      fail: number;
      maint: number;
      sum: number;
      max: number;
      samples: number[];
    } | null;
    slot: {
      slotStart: number;
      ok: number;
      fail: number;
      sum: number;
      max: number;
      maint: number;
    } | null;
  } | null>;
  ensureAlarm(): Promise<void>;
  alarmAt(): Promise<number | null>;
  runDue(now: number): Promise<{ ran: number }>;
  scheduleOf(id: string): Promise<{
    intervalMs: number;
    timeoutMs: number;
    config: unknown;
    nextCheckAt: number;
    paused: boolean;
  } | null>;
  noteSample(
    id: string,
    sample: { t: number; ok: boolean; ms: number; internal: boolean },
  ): Promise<void>;
  detach(id: string): Promise<{
    state: RuntimeState;
    nextCheckAt: number;
    lastPushAt: number | null;
    paused: boolean;
  } | null>;
  seedDemo(
    id: string,
    input: {
      paused: boolean;
      status: RuntimeState["status"];
      lastResponseMs: number | null;
      lastError: string | null;
      points: { t: number; ok: boolean; ms: number }[];
      now: number;
    },
  ): Promise<boolean>;
};

export function schedulerStub(env: Env, shardId: string): SchedulerApi {
  const id = env.SCHEDULER.idFromName(shardId);
  const hint = locationHintForShard(shardId);
  // Only the first get() for a name honors locationHint. Automatic shards,
  // including the existing shard-0, omit it so they stay where they were created.
  const stub = hint
    ? env.SCHEDULER.get(id, { locationHint: hint })
    : env.SCHEDULER.get(id);
  return stub as unknown as SchedulerApi;
}

export async function assignShard(
  env: Env,
  intervalSeconds: number,
  timeoutSeconds: number,
  region: CheckRegionId = "auto",
): Promise<string> {
  const capacity = shardCapacity(intervalSeconds, timeoutSeconds);
  const db = getDb(env.DB);
  const rows = await db
    .select({
      shardId: monitors.shardId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(monitors)
    .groupBy(monitors.shardId);
  const inRegion = rows.filter((row) => regionOfShard(row.shardId) === region);
  const open = inRegion.find((row) => row.count < capacity);
  if (open) return open.shardId;
  const used = new Set(
    inRegion
      .map((row) => shardIndex(row.shardId))
      .filter((index): index is number => index !== null),
  );
  let index = 0;
  while (used.has(index)) index += 1;
  return shardName(region, index);
}

export function snapshotFromRow(
  row: typeof monitors.$inferSelect,
  state: RuntimeState,
  nextCheckAt: number,
  lastPushAt: number | null,
  region: CheckRegionId,
): Snapshot {
  return {
    id: row.id,
    name: row.name,
    type: row.type as MonitorType,
    intervalMs: row.intervalSeconds * 1000,
    timeoutMs: row.timeoutSeconds * 1000,
    retries: row.retries,
    recoveryThreshold: row.recoveryThreshold,
    config: JSON.parse(row.configJson) as unknown,
    paused: row.paused,
    nextCheckAt,
    state,
    lastPushAt,
    regions: [region],
  };
}

export async function runInitialCheck(
  env: Env,
  row: typeof monitors.$inferSelect,
  lastPushAt: number | null,
): Promise<RuntimeState> {
  const now = Date.now();
  const config = parseMonitorConfig(
    row.type as MonitorType,
    JSON.parse(row.configJson),
  );
  const outcome = await runCheck({
    type: row.type as MonitorType,
    config: config.success ? config.data : {},
    timeoutMs: row.timeoutSeconds * 1000,
    intervalMs: row.intervalSeconds * 1000,
    lastPushAt,
    now,
  });
  const transition = applyOutcome(initialState(now), outcome, {
    retries: row.retries,
    recoveryThreshold: row.recoveryThreshold,
    now,
  });
  await saveRuntime(env.DB, row.id, transition.state);
  if (transition.openedOutage) {
    await openOutage(
      env.DB,
      row.id,
      outcome.error ?? outcome.errorKind ?? "down",
      now,
    );
  }
  const nextCheckAt =
    now + (transition.nextDelayMs ?? row.intervalSeconds * 1000);
  const region = effectiveRegion(
    storedRegion(row.regionsJson),
    await readCheckRegion(env),
  );
  const scheduler = schedulerStub(env, row.shardId);
  await scheduler.upsert(
    snapshotFromRow(row, transition.state, nextCheckAt, lastPushAt, region),
  );
  await scheduler.noteSample(row.id, {
    t: now,
    ok: outcome.ok,
    ms: outcome.responseMs,
    internal: Boolean(outcome.internal),
  });
  return transition.state;
}

export async function issueHeartbeatToken(
  env: Env,
): Promise<{ hash: string; encrypted: string; token: string }> {
  const token = randomToken("hb_");
  const key = env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY is not configured");
  return {
    hash: await sha256Hex(token),
    encrypted: await encryptString(key, token),
    token,
  };
}

export async function revealHeartbeatToken(
  env: Env,
  encrypted: string | null,
): Promise<string | null> {
  if (!encrypted || !env.ENCRYPTION_KEY) return null;
  try {
    return await decryptString(env.ENCRYPTION_KEY, encrypted);
  } catch {
    return null;
  }
}
