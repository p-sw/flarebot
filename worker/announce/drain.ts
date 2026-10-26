// SPDX-License-Identifier: MIT

import { and, eq, lte } from "drizzle-orm";
import {
  type AnnouncementEvent,
  type AnnouncementSubject,
  isAnnouncementKind,
} from "../../shared/announcements";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import {
  announcementEvents,
  announcementOutbox,
  notificationChannels,
} from "../db/schema";
import { enqueueMail } from "../mail/mailer";
import type { ChannelDelivery } from "../notify/dispatch";
import {
  ANNOUNCEMENT_ROW_STATEMENTS,
  canSpend,
  markDeferred,
} from "../scheduler/budget";
import { deliverAnnouncement } from "./deliver";

/** One cron run. Each row is at most one subrequest, inside the free-plan budget of 50. */
export const ANNOUNCEMENT_DRAIN_BATCH = 8;
const MAX_ATTEMPTS = 3;

function asSubject(value: string): AnnouncementSubject {
  return value === "maintenance" ? "maintenance" : "incident";
}

export async function drainAnnouncements(env: Env): Promise<number> {
  if (!canSpend(env.DB, 1)) {
    markDeferred(env.DB);
    return 0;
  }
  const db = getDb(env.DB);
  const now = Date.now();
  const due = await db
    .select()
    .from(announcementOutbox)
    .where(
      and(
        eq(announcementOutbox.status, "pending"),
        lte(announcementOutbox.nextAttemptAt, now),
      ),
    )
    .limit(ANNOUNCEMENT_DRAIN_BATCH);
  let sent = 0;
  for (const row of due) {
    if (!canSpend(env.DB, ANNOUNCEMENT_ROW_STATEMENTS)) {
      markDeferred(env.DB);
      break;
    }
    const eventRow = await db
      .select()
      .from(announcementEvents)
      .where(eq(announcementEvents.id, row.eventId))
      .get();
    const channel = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, row.channelId))
      .get();
    if (!eventRow || !channel || !isAnnouncementKind(eventRow.kind)) {
      await db
        .update(announcementOutbox)
        .set({
          status: "failed",
          lastError: "missing",
          attempts: row.attempts + 1,
        })
        .where(eq(announcementOutbox.id, row.id));
      continue;
    }
    if (!env.ENCRYPTION_KEY) {
      await db
        .update(announcementOutbox)
        .set({
          status: "pending",
          attempts: row.attempts + 1,
          nextAttemptAt: now + 5 * 60_000,
          lastError: "encryption",
        })
        .where(eq(announcementOutbox.id, row.id));
      continue;
    }
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(
        await decryptString(env.ENCRYPTION_KEY, channel.configEncrypted),
      ) as Record<string, unknown>;
    } catch {
      await db
        .update(announcementOutbox)
        .set({
          status: "failed",
          lastError: "config",
          attempts: row.attempts + 1,
        })
        .where(eq(announcementOutbox.id, row.id));
      continue;
    }
    const event: AnnouncementEvent = {
      kind: eventRow.kind,
      organizationId: eventRow.organizationId,
      subjectType: asSubject(eventRow.subjectType),
      subjectId: eventRow.subjectId,
      title: eventRow.title,
      summary: eventRow.summary,
      occurredAt: eventRow.createdAt,
      href: eventRow.href,
    };
    const delivery: ChannelDelivery = {
      type: channel.type as ChannelDelivery["type"],
      config,
    };
    const result = await deliverAnnouncement(delivery, event, {
      enqueueEmail: async (input) => {
        await enqueueMail(env, { kind: "announcement", ...input });
      },
    });
    if (result.ok) {
      sent += 1;
      await db
        .update(announcementOutbox)
        .set({ status: "sent", sentAt: Date.now(), lastError: null })
        .where(eq(announcementOutbox.id, row.id));
      continue;
    }
    const attempts = row.attempts + 1;
    await db
      .update(announcementOutbox)
      .set({
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        nextAttemptAt: Date.now() + attempts * 5 * 60_000,
        lastError: (result.error ?? "delivery").slice(0, 300),
      })
      .where(eq(announcementOutbox.id, row.id));
  }
  return sent;
}
