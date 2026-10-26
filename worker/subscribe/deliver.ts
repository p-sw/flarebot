// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import {
  parseMonitorIds,
  SUBSCRIPTION_DRAIN_BATCH,
  SUBSCRIPTION_FANOUT_BATCH,
  SUBSCRIPTION_WEBHOOK_FAILURES,
  subscriberWantsEvent,
  webhookUrlIssue,
} from "../../shared/subscriptions";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import { announcementEvents, statusPages, subscribers } from "../db/schema";
import { enqueueMail } from "../mail/mailer";
import { readSetting } from "../settings-store";
import { noticeMessage } from "./messages";
import { mintToken } from "./store";
import { postSignedWebhook } from "./webhook";

const ALLOW_HTTP_KEY = "subscribe_allow_http";

type EventRow = {
  id: string;
  organization_id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  title: string;
  summary: string;
  href: string | null;
  created_at: number;
};

type FanRow = {
  cursor_created_at: number;
  cursor_id: string;
  done: number;
};

type SubRow = {
  id: string;
  status_page_id: string;
  kind: string;
  email: string | null;
  follow_all: number;
  monitor_ids_json: string;
  origin: string;
  created_at: number;
};

export async function fanoutSubscriptions(env: Env): Promise<number> {
  const event = await env.DB.prepare(
    `SELECT e.id, e.organization_id, e.kind, e.subject_type, e.subject_id,
            e.title, e.summary, e.href, e.created_at
     FROM announcement_events e
     LEFT JOIN subscription_fanout f ON f.event_id = e.id
     WHERE f.event_id IS NULL OR f.done = 0
     ORDER BY e.created_at ASC
     LIMIT 1`,
  ).first<EventRow>();
  if (!event) return 0;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscription_fanout
      (event_id, cursor_created_at, cursor_id, done, updated_at)
     VALUES (?, 0, '', 0, ?)`,
  )
    .bind(event.id, now)
    .run();
  const cursor = await env.DB.prepare(
    `SELECT cursor_created_at, cursor_id, done FROM subscription_fanout WHERE event_id = ?`,
  )
    .bind(event.id)
    .first<FanRow>();
  if (!cursor || cursor.done) return 0;
  const pageTable =
    event.subject_type === "maintenance"
      ? "maintenance_pages"
      : "incident_pages";
  const idColumn =
    event.subject_type === "maintenance" ? "maintenance_id" : "incident_id";
  const monitorTable =
    event.subject_type === "maintenance"
      ? "maintenance_monitors"
      : "incident_monitors";
  const pages = await env.DB.prepare(
    `SELECT page_id AS id FROM ${pageTable} WHERE ${idColumn} = ? LIMIT 50`,
  )
    .bind(event.subject_id)
    .all<{ id: string }>();
  const pageIds = pages.results.map((row) => row.id);
  if (pageIds.length === 0) {
    await markFanout(env, event.id, cursor, true);
    return 0;
  }
  const monitors = await env.DB.prepare(
    `SELECT monitor_id AS id FROM ${monitorTable} WHERE ${idColumn} = ?`,
  )
    .bind(event.subject_id)
    .all<{ id: string }>();
  const eventMonitors = monitors.results.map((row) => row.id);
  const marks = pageIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT s.id, s.status_page_id, s.kind, s.email, s.follow_all,
            s.monitor_ids_json, s.origin, s.created_at
     FROM subscribers s
     INNER JOIN status_pages p ON p.id = s.status_page_id
     WHERE s.organization_id = ?
       AND s.status = 'confirmed'
       AND s.status_page_id IN (${marks})
       AND (
         (s.kind = 'email' AND p.subscribe_email = 1)
         OR (s.kind = 'webhook' AND p.subscribe_webhook = 1)
       )
       AND (
         s.created_at > ?
         OR (s.created_at = ? AND s.id > ?)
       )
     ORDER BY s.created_at ASC, s.id ASC
     LIMIT ?`,
  )
    .bind(
      event.organization_id,
      ...pageIds,
      cursor.cursor_created_at,
      cursor.cursor_created_at,
      cursor.cursor_id,
      SUBSCRIPTION_FANOUT_BATCH,
    )
    .all<SubRow>();
  let inserted = 0;
  for (const row of rows.results) {
    const wanted = subscriberWantsEvent(
      row.follow_all === 1,
      parseMonitorIds(row.monitor_ids_json),
      eventMonitors,
    );
    if (!wanted) continue;
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO subscription_deliveries (
        id, status_page_id, subscriber_id, event_id, status, attempts,
        next_attempt_at, last_error, created_at, sent_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?, NULL)`,
    )
      .bind(crypto.randomUUID(), row.status_page_id, row.id, event.id, now, now)
      .run();
    inserted += Number(result.meta?.changes ?? 0);
  }
  const last = rows.results[rows.results.length - 1];
  const done = rows.results.length < SUBSCRIPTION_FANOUT_BATCH;
  await markFanout(
    env,
    event.id,
    last
      ? {
          cursor_created_at: last.created_at,
          cursor_id: last.id,
          done: done ? 1 : 0,
        }
      : { ...cursor, done: 1 },
    done || !last,
  );
  return inserted;
}

async function markFanout(
  env: Env,
  eventId: string,
  cursor: FanRow,
  done: boolean,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE subscription_fanout
     SET cursor_created_at = ?, cursor_id = ?, done = ?, updated_at = ?
     WHERE event_id = ?`,
  )
    .bind(
      cursor.cursor_created_at,
      cursor.cursor_id,
      done ? 1 : 0,
      Date.now(),
      eventId,
    )
    .run();
}

type DeliveryRow = {
  id: string;
  status_page_id: string;
  subscriber_id: string;
  event_id: string;
  attempts: number;
};

export async function drainSubscriptions(env: Env): Promise<number> {
  const now = Date.now();
  const due = await env.DB.prepare(
    `SELECT id, status_page_id, subscriber_id, event_id, attempts
     FROM subscription_deliveries
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC
     LIMIT ?`,
  )
    .bind(now, SUBSCRIPTION_DRAIN_BATCH)
    .all<DeliveryRow>();
  const allowHttp = await readSetting(env, ALLOW_HTTP_KEY, false);
  let sent = 0;
  let mailed = false;
  for (const row of due.results) {
    const outcome = await sendOne(env, row, Boolean(allowHttp));
    if (outcome === "queued") mailed = true;
    if (outcome === "sent" || outcome === "queued") sent += 1;
  }
  if (mailed) {
    const stub = env.MAILER.get(env.MAILER.idFromName("mailer"));
    await stub.kick();
  }
  return sent;
}

async function sendOne(
  env: Env,
  row: DeliveryRow,
  allowHttp: boolean,
): Promise<"sent" | "queued" | "failed" | "retry"> {
  const db = getDb(env.DB);
  const subscriber = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, row.subscriber_id))
    .get();
  const event = await db
    .select()
    .from(announcementEvents)
    .where(eq(announcementEvents.id, row.event_id))
    .get();
  if (subscriber?.status !== "confirmed" || !event) {
    await finish(env, row, "failed", "missing");
    return "failed";
  }
  const page = await db
    .select()
    .from(statusPages)
    .where(eq(statusPages.id, subscriber.statusPageId))
    .get();
  if (!page) {
    await finish(env, row, "failed", "missing");
    return "failed";
  }
  if (subscriber.kind === "email") {
    if (!subscriber.email) {
      await finish(env, row, "failed", "missing");
      return "failed";
    }
    const links = await issueNoticeLinks(env, subscriber.id);
    const linked = noticeMessage({
      page: page.title,
      origin: subscriber.origin,
      kind: event.kind,
      title: event.title,
      summary: event.summary,
      href: event.href,
      manage: links.manage,
      unsubscribe: links.unsubscribe,
    });
    await enqueueMail(
      env,
      {
        kind: "subscription",
        to: subscriber.email,
        subject: linked.subject,
        text: linked.text,
        headers: linked.headers,
      },
      { kick: false },
    );
    await finish(env, row, "sent", null);
    return "queued";
  }
  if (
    !env.ENCRYPTION_KEY ||
    !subscriber.webhookUrlEncrypted ||
    !subscriber.webhookSecretEncrypted
  ) {
    await retry(env, row, "encryption");
    return "retry";
  }
  let url = "";
  let secret = "";
  try {
    url = await decryptString(
      env.ENCRYPTION_KEY,
      subscriber.webhookUrlEncrypted,
    );
    secret = await decryptString(
      env.ENCRYPTION_KEY,
      subscriber.webhookSecretEncrypted,
    );
  } catch {
    await retry(env, row, "encryption");
    return "retry";
  }
  const screened = webhookUrlIssue(url, allowHttp);
  if (!screened.ok) {
    await noteWebhookFailure(
      env,
      subscriber.id,
      subscriber.failCount,
      row,
      screened.issue,
    );
    return "failed";
  }
  const result = await postSignedWebhook(url, secret, {
    id: row.id,
    type: event.kind,
    title: event.title,
    summary: event.summary,
    href: event.href,
    occurredAt: event.createdAt,
    statusPage: { slug: page.slug, title: page.title },
  });
  if (result.ok) {
    await getDb(env.DB)
      .update(subscribers)
      .set({ failCount: 0 })
      .where(eq(subscribers.id, subscriber.id));
    await finish(env, row, "sent", null);
    return "sent";
  }
  await noteWebhookFailure(
    env,
    subscriber.id,
    subscriber.failCount,
    row,
    result.error,
  );
  return "retry";
}

async function issueNoticeLinks(
  env: Env,
  subscriberId: string,
): Promise<{ manage: string; unsubscribe: string }> {
  const manage = await mintToken(env, subscriberId, "manage", null);
  const unsubscribe = await mintToken(env, subscriberId, "unsubscribe", null);
  await getDb(env.DB)
    .update(subscribers)
    .set({
      manageTokenHash: manage.hash,
      unsubTokenHash: unsubscribe.hash,
    })
    .where(eq(subscribers.id, subscriberId));
  return { manage: manage.token, unsubscribe: unsubscribe.token };
}

async function noteWebhookFailure(
  env: Env,
  subscriberId: string,
  failCount: number,
  row: DeliveryRow,
  error: string,
): Promise<void> {
  const next = failCount + 1;
  const disable = next >= SUBSCRIPTION_WEBHOOK_FAILURES;
  await getDb(env.DB)
    .update(subscribers)
    .set({
      failCount: next,
      status: disable ? "disabled" : "confirmed",
      disabledAt: disable ? Date.now() : null,
      disabledReason: disable ? "delivery" : null,
    })
    .where(eq(subscribers.id, subscriberId));
  if (disable || row.attempts + 1 >= SUBSCRIPTION_WEBHOOK_FAILURES) {
    await finish(env, row, "failed", error);
    return;
  }
  await retry(env, row, error);
}

async function finish(
  env: Env,
  row: DeliveryRow,
  status: "sent" | "failed",
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE subscription_deliveries
     SET status = ?, attempts = ?, last_error = ?, sent_at = ?
     WHERE id = ?`,
  )
    .bind(
      status,
      row.attempts + 1,
      error,
      status === "sent" ? Date.now() : null,
      row.id,
    )
    .run();
}

async function retry(env: Env, row: DeliveryRow, error: string): Promise<void> {
  const attempts = row.attempts + 1;
  await env.DB.prepare(
    `UPDATE subscription_deliveries
     SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
     WHERE id = ?`,
  )
    .bind(
      attempts >= SUBSCRIPTION_WEBHOOK_FAILURES ? "failed" : "pending",
      attempts,
      Date.now() + attempts * 5 * 60_000,
      error.slice(0, 300),
      row.id,
    )
    .run();
}
