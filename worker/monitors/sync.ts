// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "drizzle-orm";
import type { MonitorType } from "../../shared/schemas";
import { parseMonitorConfig } from "../../shared/schemas";
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
      recent: { t: number; ok: boolean; ms: number }[];
      nextCheckAt: number;
      lastPushAt: number | null;
      rollup: {
        hourStart: number;
        ok: number;
        fail: number;
        sum: number;
        max: number;
        samples: number[];
      } | null;
    }[]
  >;
  getOne(id: string): Promise<{
    state: RuntimeState;
    recent: { t: number; ok: boolean; ms: number }[];
    nextCheckAt: number;
    lastPushAt: number | null;
    rollup: {
      hourStart: number;
      ok: number;
      fail: number;
      sum: number;
      max: number;
      samples: number[];
    } | null;
  } | null>;
  ensureAlarm(): Promise<void>;
  runDue(now: number): Promise<{ ran: number }>;
  noteSample(
    id: string,
    sample: { t: number; ok: boolean; ms: number; internal: boolean },
  ): Promise<void>;
};

export function schedulerStub(env: Env, shardId: string): SchedulerApi {
  return env.SCHEDULER.get(
    env.SCHEDULER.idFromName(shardId),
  ) as unknown as SchedulerApi;
}

export async function assignShard(
  env: Env,
  intervalSeconds: number,
  timeoutSeconds: number,
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
  const open = rows.find((row) => row.count < capacity);
  if (open) return open.shardId;
  return `shard-${rows.length}`;
}

export function snapshotFromRow(
  row: typeof monitors.$inferSelect,
  state: RuntimeState,
  nextCheckAt: number,
  lastPushAt: number | null,
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
    regions: JSON.parse(row.regionsJson) as string[],
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
  const scheduler = schedulerStub(env, row.shardId);
  await scheduler.upsert(
    snapshotFromRow(row, transition.state, nextCheckAt, lastPushAt),
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
