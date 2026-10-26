// SPDX-License-Identifier: MIT

import { and, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import { announcementHref } from "../../shared/announcements";
import { nextOccurrences } from "../../shared/recurrence";
import { getDb } from "../db/client";
import {
  maintenanceChannels,
  maintenancePages,
  maintenanceSignals,
  maintenanceWindows,
  statusPages,
} from "../db/schema";
import { scheduleFromRow } from "../maintenance";
import {
  canSpend,
  markDeferred,
  SIGNAL_EMIT_STATEMENTS,
} from "../scheduler/budget";
import { publishAnnouncement } from "./publish";

/** New start/complete events written on one cron run. The rest wait five minutes. */
export const MAINTENANCE_SIGNAL_BATCH = 8;
const LOOKBACK_MS = 6 * 60 * 60 * 1000;

async function hrefFor(
  database: D1Database,
  maintenanceId: string,
): Promise<string | null> {
  const db = getDb(database);
  const link = await db
    .select({ slug: statusPages.slug })
    .from(maintenancePages)
    .innerJoin(statusPages, eq(statusPages.id, maintenancePages.pageId))
    .where(eq(maintenancePages.maintenanceId, maintenanceId))
    .get();
  return announcementHref("maintenance", link?.slug ?? null, maintenanceId);
}

async function channelIds(
  database: D1Database,
  maintenanceId: string,
  notify: boolean,
): Promise<string[]> {
  if (!notify) return [];
  const rows = await getDb(database)
    .select({ channelId: maintenanceChannels.channelId })
    .from(maintenanceChannels)
    .where(eq(maintenanceChannels.maintenanceId, maintenanceId));
  return rows.map((row) => row.channelId);
}

/**
 * Emit maintenance.started and maintenance.completed for occurrences that
 * began or ended in the last six hours. Eight events per cron keeps the
 * write burst small. Channel rows are attached only when the window opted in.
 */
export async function emitMaintenanceSignals(
  env: Env,
  now = Date.now(),
): Promise<number> {
  const db = getDb(env.DB);
  const windows = await db
    .select()
    .from(maintenanceWindows)
    .where(
      or(
        isNull(maintenanceWindows.cancelledAt),
        gt(maintenanceWindows.cancelledAt, now - LOOKBACK_MS),
      ),
    )
    .limit(100);
  const known = new Set<string>();
  if (windows.length > 0) {
    if (!canSpend(env.DB, 1)) {
      markDeferred(env.DB);
      return 0;
    }
    const signalSince = now - LOOKBACK_MS - 21 * 86_400_000;
    const rows = await db
      .select({
        maintenanceId: maintenanceSignals.maintenanceId,
        occurrenceStart: maintenanceSignals.occurrenceStart,
        kind: maintenanceSignals.kind,
      })
      .from(maintenanceSignals)
      .where(
        and(
          inArray(
            maintenanceSignals.maintenanceId,
            windows.map((window) => window.id),
          ),
          gte(maintenanceSignals.occurrenceStart, signalSince),
        ),
      );
    for (const row of rows) {
      known.add(`${row.maintenanceId}:${row.occurrenceStart}:${row.kind}`);
    }
  }
  let emitted = 0;
  for (const window of windows) {
    if (emitted >= MAINTENANCE_SIGNAL_BATCH) break;
    const schedule = scheduleFromRow(window);
    if (!schedule) continue;
    const occurrences = nextOccurrences(
      schedule,
      now - LOOKBACK_MS - (schedule.endAt - schedule.startAt),
      6,
    );
    for (const occurrence of occurrences) {
      if (emitted >= MAINTENANCE_SIGNAL_BATCH) break;
      const started =
        occurrence.start <= now && occurrence.start >= now - LOOKBACK_MS;
      const completed =
        occurrence.end <= now && occurrence.end >= now - LOOKBACK_MS;
      const kinds = [
        started ? "started" : null,
        completed ? "completed" : null,
      ].filter((kind): kind is "started" | "completed" => kind != null);
      for (const kind of kinds) {
        if (emitted >= MAINTENANCE_SIGNAL_BATCH) break;
        const key = `${window.id}:${occurrence.start}:${kind}`;
        if (known.has(key)) continue;
        if (!canSpend(env.DB, SIGNAL_EMIT_STATEMENTS)) {
          markDeferred(env.DB);
          return emitted;
        }
        const href = await hrefFor(env.DB, window.id);
        await publishAnnouncement(
          env.DB,
          {
            kind:
              kind === "started"
                ? "maintenance.started"
                : "maintenance.completed",
            organizationId: window.organizationId,
            subjectType: "maintenance",
            subjectId: window.id,
            title: window.title,
            summary: window.description,
            occurredAt: kind === "started" ? occurrence.start : occurrence.end,
            href,
          },
          await channelIds(env.DB, window.id, window.notify),
        );
        await db.insert(maintenanceSignals).values({
          maintenanceId: window.id,
          occurrenceStart: occurrence.start,
          kind,
          createdAt: now,
        });
        known.add(key);
        emitted += 1;
      }
    }
  }
  return emitted;
}
