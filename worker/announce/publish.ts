// SPDX-License-Identifier: MIT

import type { AnnouncementEvent } from "../../shared/announcements";
import { getDb } from "../db/client";
import { announcementEvents, announcementOutbox } from "../db/schema";

/** Channels attached to one event. Extra ids are ignored. */
export const ANNOUNCEMENT_CHANNEL_CAP = 20;

/**
 * Record an announcement and enqueue channel delivery.
 *
 * Call this from incident and maintenance code. Do not deliver HTTP from the
 * request that published the event. `drainAnnouncements` sends at most
 * `ANNOUNCEMENT_DRAIN_BATCH` rows on the existing five-minute cron.
 *
 * Pass `channelIds: []` to keep the event in the log without paging anyone.
 * A later subscription sink should read `announcement_events` or wrap this
 * function. See docs/announcements.md and shared/announcements.ts.
 */
export async function publishAnnouncement(
  database: D1Database,
  event: AnnouncementEvent,
  channelIds: readonly string[],
): Promise<string> {
  const db = getDb(database);
  const eventId = crypto.randomUUID();
  const now = Date.now();
  await db.insert(announcementEvents).values({
    id: eventId,
    organizationId: event.organizationId,
    kind: event.kind,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    title: event.title,
    summary: event.summary.slice(0, 2000),
    href: event.href,
    createdAt: event.occurredAt || now,
  });
  const unique = [...new Set(channelIds.filter(Boolean))].slice(
    0,
    ANNOUNCEMENT_CHANNEL_CAP,
  );
  if (unique.length > 0) {
    await db.insert(announcementOutbox).values(
      unique.map((channelId) => ({
        id: crypto.randomUUID(),
        eventId,
        channelId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        createdAt: now,
        sentAt: null,
      })),
    );
  }
  return eventId;
}
