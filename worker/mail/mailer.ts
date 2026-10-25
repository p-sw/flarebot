// SPDX-License-Identifier: MIT

import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { mailOutbox, mailSettings } from "../db/schema";
import { deliverWith, resolveMail } from "./resolve";
import { nextRetryDelay } from "./retry";

export class Mailer extends DurableObject<Env> {
  async kick(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > Date.now() + 500) {
      await this.ctx.storage.setAlarm(Date.now() + 200);
    }
  }

  async alarm(): Promise<void> {
    await this.pump();
  }

  async pump(): Promise<void> {
    const db = getDb(this.env.DB);
    const now = Date.now();
    const stale = await db
      .select()
      .from(mailOutbox)
      .where(eq(mailOutbox.status, "sending"))
      .limit(5);
    for (const row of stale) {
      if (
        now - row.createdAt > 2 * 60_000 &&
        (row.sentAt === null || now - (row.nextAttemptAt ?? now) > 60_000)
      ) {
        await db
          .update(mailOutbox)
          .set({ status: "pending" })
          .where(eq(mailOutbox.id, row.id));
      }
    }
    const due = await db
      .select()
      .from(mailOutbox)
      .where(eq(mailOutbox.status, "pending"))
      .limit(20);
    const next = due.find((row) => row.nextAttemptAt <= now);
    if (!next) {
      const future = due.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
      if (future) await this.ctx.storage.setAlarm(future.nextAttemptAt);
      return;
    }
    const claimed = await this.env.DB.prepare(
      "UPDATE mail_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'",
    )
      .bind(next.id)
      .run();
    if (!claimed.meta.changes) return;
    const settings = await db
      .select()
      .from(mailSettings)
      .where(eq(mailSettings.id, 1))
      .get();
    const resolved = await resolveMail(this.env, settings ?? null);
    const result = await deliverWith(this.env, resolved, {
      to: next.toAddress,
      subject: next.subject,
      text: next.textBody,
      messageId: next.messageId,
    });
    const attempts = next.attempts + 1;
    if (result.ok) {
      await db
        .update(mailOutbox)
        .set({ status: "sent", attempts, sentAt: Date.now(), lastError: null })
        .where(eq(mailOutbox.id, next.id));
    } else {
      const delay = result.permanent ? null : nextRetryDelay(attempts);
      await db
        .update(mailOutbox)
        .set({
          status: delay === null ? "failed" : "pending",
          attempts,
          lastError: `${result.stage}: ${result.message}`.slice(0, 500),
          nextAttemptAt:
            delay === null ? next.nextAttemptAt : Date.now() + delay,
        })
        .where(eq(mailOutbox.id, next.id));
      if (delay !== null) await this.ctx.storage.setAlarm(Date.now() + delay);
    }
    const more = await db
      .select({ id: mailOutbox.id })
      .from(mailOutbox)
      .where(eq(mailOutbox.status, "pending"))
      .limit(1);
    if (more.length > 0) await this.ctx.storage.setAlarm(Date.now() + 250);
  }
}

export async function enqueueMail(
  env: Env,
  input: { kind: string; to: string; subject: string; text: string },
): Promise<string> {
  const db = getDb(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(mailOutbox).values({
    id,
    kind: input.kind,
    toAddress: input.to,
    subject: input.subject,
    textBody: input.text,
    htmlBody: null,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    messageId: `<${id}@flarebot.local>`,
    createdAt: now,
    sentAt: null,
  });
  const stub = env.MAILER.get(env.MAILER.idFromName("mailer"));
  await stub.kick();
  return id;
}
