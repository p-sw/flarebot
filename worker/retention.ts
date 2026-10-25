// SPDX-License-Identifier: MIT

import {
  firstRetainedDay,
  HISTORY_PRUNE_STATE_KEY,
  HISTORY_RETENTION_KEY,
  normalizeRetentionDays,
  PRUNE_BATCH,
  PRUNE_DAILY_CAP,
  type PruneState,
  parsePruneState,
  retentionCutoff,
  shouldPrune,
} from "../shared/history";
import { readSetting, writeSetting } from "./settings-store";

export type PruneResult = {
  skipped: boolean;
  deleted: number;
  hourly: number;
  daily: number;
  outages: number;
  caughtUp: boolean;
  retentionDays: number;
};

const DELETE_HOURLY = `DELETE FROM uptime_hourly WHERE rowid IN (
  SELECT rowid FROM uptime_hourly
  WHERE hour_start < ?
  ORDER BY hour_start ASC
  LIMIT ?
)`;

const DELETE_DAILY = `DELETE FROM uptime_daily WHERE rowid IN (
  SELECT rowid FROM uptime_daily
  WHERE day_start < ?
  ORDER BY day_start ASC
  LIMIT ?
)`;

const DELETE_OUTAGES = `DELETE FROM outages WHERE rowid IN (
  SELECT rowid FROM outages
  WHERE ended_at IS NOT NULL AND ended_at < ?
  ORDER BY ended_at ASC
  LIMIT ?
)`;

async function deleteBatch(
  database: D1Database,
  sql: string,
  before: number,
  limit: number,
): Promise<number> {
  if (limit <= 0) return 0;
  const result = await database.prepare(sql).bind(before, limit).run();
  return Number(result.meta?.changes ?? 0);
}

export async function historyRetentionDays(env: Env): Promise<number> {
  return normalizeRetentionDays(
    await readSetting<unknown>(env, HISTORY_RETENTION_KEY, null),
  );
}

export async function pruneHistory(
  env: Env,
  now = Date.now(),
): Promise<PruneResult> {
  const state = parsePruneState(
    await readSetting<unknown>(env, HISTORY_PRUNE_STATE_KEY, null),
  );
  const decision = shouldPrune(state, now);
  const retentionDays = await historyRetentionDays(env);
  if (!decision.run) {
    return {
      skipped: true,
      deleted: 0,
      hourly: 0,
      daily: 0,
      outages: 0,
      caughtUp: state.caughtUp,
      retentionDays,
    };
  }
  const retainedFrom = firstRetainedDay(retentionCutoff(now, retentionDays));
  let budget = PRUNE_DAILY_CAP - decision.deletedToday;
  const hourLimit = Math.min(PRUNE_BATCH, budget);
  const hourly = await deleteBatch(
    env.DB,
    DELETE_HOURLY,
    retainedFrom,
    hourLimit,
  );
  budget -= hourly;
  const dayLimit = Math.min(PRUNE_BATCH, budget);
  const daily = await deleteBatch(env.DB, DELETE_DAILY, retainedFrom, dayLimit);
  budget -= daily;
  const outageLimit = Math.min(PRUNE_BATCH, budget);
  const outages = await deleteBatch(
    env.DB,
    DELETE_OUTAGES,
    retentionCutoff(now, retentionDays),
    outageLimit,
  );
  const deleted = hourly + daily + outages;
  const caughtUp =
    hourly < hourLimit && daily < dayLimit && outages < outageLimit;
  const next: PruneState = {
    at: now,
    dayStart: decision.dayStart,
    deleted: decision.deletedToday + deleted,
    caughtUp,
  };
  await writeSetting(env, HISTORY_PRUNE_STATE_KEY, next);
  return {
    skipped: false,
    deleted,
    hourly,
    daily,
    outages,
    caughtUp,
    retentionDays,
  };
}
