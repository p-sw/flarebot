// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { mailOutbox, monitors } from "../db/schema";
import { rollDaily } from "./persist";

export async function watchdog(env: Env): Promise<void> {
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
  const cutoff = Date.now() - 14 * 86_400_000;
  await db
    .delete(mailOutbox)
    .where(and(eq(mailOutbox.status, "sent"), lt(mailOutbox.sentAt, cutoff)));
}
