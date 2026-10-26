// SPDX-License-Identifier: MIT

import { and, eq, lt } from "drizzle-orm";
import { drainAnnouncements } from "../announce/drain";
import { emitMaintenanceSignals } from "../announce/signals";
import { getDb } from "../db/client";
import { mailOutbox, monitors } from "../db/schema";
import { pruneHistory } from "../retention";
import { drainSubscriptions, fanoutSubscriptions } from "../subscribe/deliver";
import {
  CronBudgetDeferred,
  canSpend,
  FREE_CRON_STATEMENT_BUDGET,
  markDeferred,
  openCronBudget,
  withDatabase,
} from "./budget";
import { rollDaily } from "./persist";

export async function watchdog(env: Env): Promise<void> {
  await runScheduled(env);
}

export async function runScheduled(
  env: Env,
  limit = FREE_CRON_STATEMENT_BUDGET,
): Promise<{ used: number; deferred: boolean }> {
  const budget = openCronBudget(env.DB, limit);
  const scoped = withDatabase(env, budget.database);
  try {
    await scheduledBody(scoped);
  } catch (error) {
    if (!(error instanceof CronBudgetDeferred)) throw error;
    return { used: budget.used(), deferred: true };
  }
  return { used: budget.used(), deferred: budget.deferred() };
}

async function scheduledBody(env: Env): Promise<void> {
  const db = getDb(env.DB);
  const shards = await db
    .selectDistinct({ shardId: monitors.shardId })
    .from(monitors);
  for (const shard of shards) {
    const stub = env.SCHEDULER.get(env.SCHEDULER.idFromName(shard.shardId));
    await stub.ensureAlarm();
  }
  await env.MAILER.get(env.MAILER.idFromName("mailer")).kick();
  await rollDaily(env.DB);
  await pruneHistory(env);
  await emitMaintenanceSignals(env);
  await drainAnnouncements(env);
  await fanoutSubscriptions(env);
  await drainSubscriptions(env);
  if (!canSpend(env.DB, 1)) {
    markDeferred(env.DB);
    return;
  }
  const cutoff = Date.now() - 14 * 86_400_000;
  await db
    .delete(mailOutbox)
    .where(and(eq(mailOutbox.status, "sent"), lt(mailOutbox.sentAt, cutoff)));
}
