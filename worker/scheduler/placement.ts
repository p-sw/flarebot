// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import {
  type CheckRegionId,
  effectiveRegion,
  regionOfShard,
  storedRegion,
} from "../../shared/regions";
import { readCheckRegion } from "../check-region";
import { getDb } from "../db/client";
import { monitorState, monitors } from "../db/schema";
import { assignShard, schedulerStub, snapshotFromRow } from "../monitors/sync";
import { canSpend, markDeferred } from "./budget";
import { saveRuntime } from "./persist";
import { initialState, type RuntimeState } from "./state-machine";

/**
 * One settings read plus the monitor list. Each move then spends one
 * group-by (capacity), an optional state read, and the shard_id update.
 * The detach flush runs inside the shard, on that invocation's own budget.
 * Four moves stay far under the cron's 40-statement cap.
 */
export const PLACEMENT_SCAN_STATEMENTS = 2;
export const PLACEMENT_MOVE_STATEMENTS = 3;
export const PLACEMENT_BATCH = 4;

export type PlacementResult = {
  moved: number;
  remaining: number;
  deferred: boolean;
};

/**
 * Move monitors whose shard region does not match the resolved choice.
 * Idempotent: a monitor already on the right region is left alone, and a
 * retry after a crash detaches an empty source and upserts the destination
 * again. The recent-results buffer is not copied.
 */
export async function settlePlacement(
  env: Env,
  limit = PLACEMENT_BATCH,
): Promise<PlacementResult> {
  if (!canSpend(env.DB, PLACEMENT_SCAN_STATEMENTS)) {
    markDeferred(env.DB);
    return { moved: 0, remaining: 0, deferred: true };
  }
  const globalRegion = await readCheckRegion(env);
  const rows = await getDb(env.DB).select().from(monitors);
  const pending = rows.filter((row) => needsMove(row, globalRegion));
  let moved = 0;
  for (const row of pending) {
    if (moved >= limit) break;
    if (!canSpend(env.DB, PLACEMENT_MOVE_STATEMENTS)) {
      markDeferred(env.DB);
      return {
        moved,
        remaining: pending.length - moved,
        deferred: true,
      };
    }
    await relocateMonitor(env, row, globalRegion);
    moved += 1;
  }
  return {
    moved,
    remaining: pending.length - moved,
    deferred: false,
  };
}

export function needsMove(
  row: { shardId: string; regionsJson: string },
  globalRegion: CheckRegionId,
): boolean {
  const current = regionOfShard(row.shardId);
  if (!current) return false;
  return (
    current !== effectiveRegion(storedRegion(row.regionsJson), globalRegion)
  );
}

/**
 * Detach from the old shard first so two shards never check the monitor.
 * `shard_id` is updated only after the new snapshot is stored, so a crash
 * leaves the row pointing at the old name and the next pass retries.
 */
export async function relocateMonitor(
  env: Env,
  row: typeof monitors.$inferSelect,
  globalRegion: CheckRegionId,
): Promise<string> {
  const desired = effectiveRegion(storedRegion(row.regionsJson), globalRegion);
  const current = regionOfShard(row.shardId);
  if (!current || current === desired) return row.shardId;
  const shardId = await assignShard(
    env,
    row.intervalSeconds,
    row.timeoutSeconds,
    desired,
  );
  const detached = await schedulerStub(env, row.shardId)
    .detach(row.id)
    .catch(() => null);
  const state = detached?.state ?? (await loadRuntime(env, row.id));
  const now = Date.now();
  const nextCheckAt =
    detached?.nextCheckAt ??
    (row.paused ? now + 365 * 86_400_000 : now + row.intervalSeconds * 1000);
  await schedulerStub(env, shardId).upsert(
    snapshotFromRow(
      row,
      state,
      nextCheckAt,
      detached?.lastPushAt ?? null,
      desired,
    ),
  );
  await schedulerStub(env, shardId).ensureAlarm();
  await getDb(env.DB)
    .update(monitors)
    .set({ shardId, updatedAt: now })
    .where(eq(monitors.id, row.id));
  return shardId;
}

/**
 * Edit path. The caller already resolved the runtime it wants stored.
 * Same detach-then-upsert order as a global move.
 */
export async function placeEditedMonitor(
  env: Env,
  row: typeof monitors.$inferSelect,
  input: {
    previousShardId: string;
    state: RuntimeState;
    nextCheckAt: number;
    lastPushAt: number | null;
    globalRegion: CheckRegionId;
  },
): Promise<string> {
  const desired = effectiveRegion(
    storedRegion(row.regionsJson),
    input.globalRegion,
  );
  const current = regionOfShard(input.previousShardId);
  let shardId = input.previousShardId;
  if (current && current !== desired) {
    shardId = await assignShard(
      env,
      row.intervalSeconds,
      row.timeoutSeconds,
      desired,
    );
    if (shardId !== input.previousShardId) {
      await schedulerStub(env, input.previousShardId)
        .detach(row.id)
        .catch(() => null);
    }
  }
  await saveRuntime(env.DB, row.id, input.state);
  await schedulerStub(env, shardId).upsert(
    snapshotFromRow(
      row,
      input.state,
      input.nextCheckAt,
      input.lastPushAt,
      desired,
    ),
  );
  if (shardId !== input.previousShardId) {
    await getDb(env.DB)
      .update(monitors)
      .set({ shardId, updatedAt: Date.now() })
      .where(eq(monitors.id, row.id));
    await schedulerStub(env, shardId).ensureAlarm();
  }
  return shardId;
}

async function loadRuntime(env: Env, id: string): Promise<RuntimeState> {
  const stored = await getDb(env.DB)
    .select()
    .from(monitorState)
    .where(eq(monitorState.monitorId, id))
    .get();
  if (!stored) return initialState(Date.now());
  return {
    status: stored.status as RuntimeState["status"],
    consecutiveFailures: stored.consecutiveFailures,
    consecutiveSuccesses: stored.consecutiveSuccesses,
    transitions: [],
    flappingNotified: stored.flapping,
    lastResponseMs: stored.lastResponseMs,
    statusSince: stored.since,
    lastCheckAt: stored.lastCheckAt,
    lastError: stored.lastError,
  };
}
