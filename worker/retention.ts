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
import {
  canSpend,
  markDeferred,
  PRUNE_RUN_STATEMENTS,
} from "./scheduler/budget";
import { readSetting, writeSetting } from "./settings-store";

export type PruneResult = {
  skipped: boolean;
  deleted: number;
  slots: number;
  hourly: number;
  daily: number;
  outages: number;
  incidents: number;
  maintenance: number;
  announcements: number;
  deliveries: number;
  expiredPending: number;
  caughtUp: boolean;
  retentionDays: number;
};

const DELETE_SLOTS = `DELETE FROM uptime_slots WHERE rowid IN (
  SELECT rowid FROM uptime_slots
  WHERE slot_start < ?
  ORDER BY slot_start ASC
  LIMIT ?
)`;

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

const DELETE_INCIDENTS = `DELETE FROM incidents WHERE rowid IN (
  SELECT rowid FROM incidents
  WHERE resolved_at IS NOT NULL AND resolved_at < ?
  ORDER BY resolved_at ASC
  LIMIT ?
)`;

const DELETE_MAINTENANCE = `DELETE FROM maintenance_windows WHERE rowid IN (
  SELECT rowid FROM maintenance_windows
  WHERE (recurrence = 'once' AND end_at < ?)
     OR (cancelled_at IS NOT NULL AND cancelled_at < ?)
  ORDER BY COALESCE(cancelled_at, end_at) ASC
  LIMIT ?
)`;

const DELETE_ANNOUNCEMENTS = `DELETE FROM announcement_events WHERE rowid IN (
  SELECT rowid FROM announcement_events
  WHERE created_at < ?
  ORDER BY created_at ASC
  LIMIT ?
)`;

const DELETE_DELIVERIES = `DELETE FROM subscription_deliveries WHERE rowid IN (
  SELECT rowid FROM subscription_deliveries
  WHERE status != 'pending' AND created_at < ?
  ORDER BY created_at ASC
  LIMIT ?
)`;

const DELETE_EXPIRED_PENDING = `DELETE FROM subscribers WHERE rowid IN (
  SELECT rowid FROM subscribers
  WHERE status = 'pending' AND confirm_expires_at IS NOT NULL AND confirm_expires_at < ?
  ORDER BY confirm_expires_at ASC
  LIMIT ?
)`;

const DELETE_SUBSCRIPTION_TOKENS = `DELETE FROM subscription_tokens WHERE rowid IN (
  SELECT rowid FROM subscription_tokens
  WHERE created_at < ? OR (expires_at IS NOT NULL AND expires_at < ?)
  ORDER BY created_at ASC
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
      slots: 0,
      hourly: 0,
      daily: 0,
      outages: 0,
      incidents: 0,
      maintenance: 0,
      announcements: 0,
      deliveries: 0,
      expiredPending: 0,
      caughtUp: state.caughtUp,
      retentionDays,
    };
  }
  if (!canSpend(env.DB, PRUNE_RUN_STATEMENTS)) {
    markDeferred(env.DB);
    return {
      skipped: true,
      deleted: 0,
      slots: 0,
      hourly: 0,
      daily: 0,
      outages: 0,
      incidents: 0,
      maintenance: 0,
      announcements: 0,
      deliveries: 0,
      expiredPending: 0,
      caughtUp: state.caughtUp,
      retentionDays,
    };
  }
  const retainedFrom = firstRetainedDay(retentionCutoff(now, retentionDays));
  let budget = PRUNE_DAILY_CAP - decision.deletedToday;
  const slotLimit = Math.min(PRUNE_BATCH, budget);
  const slots = await deleteBatch(
    env.DB,
    DELETE_SLOTS,
    retainedFrom,
    slotLimit,
  );
  budget -= slots;
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
  const cutoff = retentionCutoff(now, retentionDays);
  const outages = await deleteBatch(
    env.DB,
    DELETE_OUTAGES,
    cutoff,
    outageLimit,
  );
  budget -= outages;
  const incidentLimit = Math.min(PRUNE_BATCH, budget);
  const incidents = await deleteBatch(
    env.DB,
    DELETE_INCIDENTS,
    cutoff,
    incidentLimit,
  );
  budget -= incidents;
  const maintenanceLimit = Math.min(PRUNE_BATCH, budget);
  const maintenance =
    maintenanceLimit <= 0
      ? 0
      : Number(
          (
            await env.DB.prepare(DELETE_MAINTENANCE)
              .bind(cutoff, cutoff, maintenanceLimit)
              .run()
          ).meta?.changes ?? 0,
        );
  budget -= maintenance;
  const announcementLimit = Math.min(PRUNE_BATCH, budget);
  const announcements = await deleteBatch(
    env.DB,
    DELETE_ANNOUNCEMENTS,
    cutoff,
    announcementLimit,
  );
  budget -= announcements;
  const deliveryLimit = Math.min(PRUNE_BATCH, budget);
  const deliveries = await deleteBatch(
    env.DB,
    DELETE_DELIVERIES,
    cutoff,
    deliveryLimit,
  );
  budget -= deliveries;
  const pendingLimit = Math.min(PRUNE_BATCH, budget);
  const expiredPending = await deleteBatch(
    env.DB,
    DELETE_EXPIRED_PENDING,
    now,
    pendingLimit,
  );
  budget -= expiredPending;
  const tokenLimit = Math.min(PRUNE_BATCH, budget);
  const tokens =
    tokenLimit <= 0
      ? 0
      : Number(
          (
            await env.DB.prepare(DELETE_SUBSCRIPTION_TOKENS)
              .bind(cutoff, now, tokenLimit)
              .run()
          ).meta?.changes ?? 0,
        );
  const deleted =
    slots +
    hourly +
    daily +
    outages +
    incidents +
    maintenance +
    announcements +
    deliveries +
    expiredPending +
    tokens;
  const caughtUp =
    slots < slotLimit &&
    hourly < hourLimit &&
    daily < dayLimit &&
    outages < outageLimit &&
    incidents < incidentLimit &&
    maintenance < maintenanceLimit &&
    announcements < announcementLimit &&
    deliveries < deliveryLimit &&
    expiredPending < pendingLimit &&
    tokens < tokenLimit;
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
    slots,
    hourly,
    daily,
    outages,
    incidents,
    maintenance,
    announcements,
    deliveries,
    expiredPending,
    caughtUp,
    retentionDays,
  };
}
