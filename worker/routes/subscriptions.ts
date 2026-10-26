// SPDX-License-Identifier: MIT

import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { t } from "../../shared/copy";
import {
  subscribePreferencesSchema,
  subscribeRequestSchema,
  subscriptionFlagsSchema,
} from "../../shared/schemas";
import { decryptString, randomToken, sha256Hex } from "../crypto/secret";
import { getDb } from "../db/client";
import { statusPages, subscribers } from "../db/schema";
import {
  ApiError,
  type AppEnv,
  audit,
  clientIp,
  parseBody,
  requestOrigin,
  requireActor,
  requireCan,
  verifyTurnstile,
} from "../http";
import { enqueueMail } from "../mail/mailer";
import { alreadyMessage, confirmMessage } from "../subscribe/messages";
import {
  assertChoice,
  limited,
  manageView,
  pageMonitorIds,
  rememberConfirmedLinks,
  saveEmailSubscriber,
  saveWebhookSubscriber,
  unsubscribeSubscriber,
  updatePreferences,
} from "../subscribe/store";
import {
  allowHttpWebhooks,
  mailIsConfigured,
  subscribeTurnstile,
} from "../subscribe/view";
import { postSignedWebhook, screenWebhookUrl } from "../subscribe/webhook";

function assertSameOrigin(origin: string | undefined, expected: string): void {
  if (!origin || origin !== expected) {
    throw new ApiError(403, "origin", t("error_origin"));
  }
}

async function ownedPage(env: Env, organizationId: string, id: string) {
  const page = await getDb(env.DB)
    .select()
    .from(statusPages)
    .where(
      and(
        eq(statusPages.id, id),
        eq(statusPages.organizationId, organizationId),
      ),
    )
    .get();
  if (!page) throw new ApiError(404, "not_found", t("error_page_not_found"));
  return page;
}

export function registerSubscriptions(app: Hono<AppEnv>): void {
  app.post("/api/public/subscribe", async (c) => {
    assertSameOrigin(c.req.header("origin"), requestOrigin(c));
    const body = await parseBody(c, subscribeRequestSchema);
    const page = await getDb(c.env.DB)
      .select()
      .from(statusPages)
      .where(eq(statusPages.slug, body.slug))
      .get();
    if (!page?.published) {
      throw new ApiError(404, "not_found", t("error_page_not_found"));
    }
    const monitors = await pageMonitorIds(c.env, page.id);
    const chosen = assertChoice(
      body.followAll,
      body.monitorIds,
      new Set(monitors.keys()),
    );
    const turnstile = await subscribeTurnstile(c.env);
    if (turnstile) {
      await verifyTurnstile(
        c.env,
        body.turnstileToken,
        clientIp(c),
        turnstile.secret,
      );
    }
    const ip = clientIp(c);
    if (ip && (await limited(c.env, "ip", await sha256Hex(ip)))) {
      throw new ApiError(429, "subscribe_rate", t("error_subscribe_rate"));
    }
    const origin = requestOrigin(c);
    if (body.kind === "email") {
      if (!page.subscribeEmail) {
        throw new ApiError(
          400,
          "subscribe_closed",
          t("error_subscribe_closed"),
        );
      }
      if (!(await mailIsConfigured(c.env))) {
        throw new ApiError(400, "subscribe_mail", t("error_subscribe_mail"));
      }
      const email = body.email?.trim().toLowerCase();
      if (!email) throw new ApiError(400, "validation", t("error_validation"));
      if (
        await limited(
          c.env,
          "addr",
          await sha256Hex(`${page.id}:email:${email}`),
        )
      ) {
        throw new ApiError(429, "subscribe_rate", t("error_subscribe_rate"));
      }
      const saved = await saveEmailSubscriber(c.env, {
        organizationId: page.organizationId,
        pageId: page.id,
        origin,
        email,
        followAll: body.followAll,
        monitorIds: chosen,
      });
      if (saved.action === "already") {
        const links = await rememberConfirmedLinks(c.env, page.id, email);
        if (links) {
          const message = alreadyMessage({
            page: page.title,
            origin,
            manage: links.manage,
            unsubscribe: links.unsubscribe,
          });
          await enqueueMail(c.env, {
            kind: "subscription",
            to: email,
            subject: message.subject,
            text: message.text,
            headers: message.headers,
          });
        }
        return c.json({ ok: true, kind: "email", pending: true });
      }
      const message = confirmMessage({
        page: page.title,
        origin,
        confirm: saved.confirm,
        manage: saved.manage,
        unsubscribe: saved.unsubscribe,
      });
      await enqueueMail(c.env, {
        kind: "subscription",
        to: saved.email,
        subject: message.subject,
        text: message.text,
        headers: message.headers,
      });
      return c.json({ ok: true, kind: "email", pending: true });
    }
    if (!page.subscribeWebhook) {
      throw new ApiError(400, "subscribe_closed", t("error_subscribe_closed"));
    }
    const webhookUrl = body.webhookUrl?.trim() ?? "";
    if (!webhookUrl)
      throw new ApiError(400, "validation", t("error_validation"));
    if (
      await limited(
        c.env,
        "addr",
        await sha256Hex(`${page.id}:webhook:${webhookUrl}`),
      )
    ) {
      throw new ApiError(429, "subscribe_rate", t("error_subscribe_rate"));
    }
    const allowHttp = await allowHttpWebhooks(c.env);
    const screened = await screenWebhookUrl(webhookUrl, allowHttp);
    if (!screened.ok) {
      const message =
        screened.issue === "http"
          ? t("error_subscribe_http")
          : screened.issue === "dns"
            ? t("error_subscribe_dns")
            : t("error_subscribe_private");
      throw new ApiError(400, "subscribe_url", message);
    }
    if (!c.env.ENCRYPTION_KEY) {
      throw new ApiError(
        400,
        "subscribe_mail",
        t("error_subscribe_encryption"),
      );
    }
    const secret = randomToken();
    const id = crypto.randomUUID();
    const ping = await postSignedWebhook(screened.href, secret, {
      id,
      type: "subscription.verify",
      occurredAt: Date.now(),
      statusPage: { slug: page.slug, title: page.title },
    });
    if (!ping.ok) {
      throw new ApiError(400, "subscribe_verify", t("error_subscribe_verify"));
    }
    await saveWebhookSubscriber(c.env, {
      organizationId: page.organizationId,
      pageId: page.id,
      origin,
      href: screened.href,
      secret,
      followAll: body.followAll,
      monitorIds: chosen,
    });
    return c.json({ ok: true, kind: "webhook", secret });
  });

  app.get("/api/public/subscribe/manage/:token", async (c) => {
    const view = await manageView(c.env, c.req.param("token"));
    if (!view)
      throw new ApiError(404, "subscribe_token", t("error_subscribe_token"));
    return c.json({
      pageTitle: view.page.title,
      slug: view.page.slug,
      kind: view.row.kind,
      email: view.row.email,
      status: view.row.status,
      followAll: view.row.followAll,
      monitorIds: view.monitorIds,
      components: view.components,
    });
  });

  app.put("/api/public/subscribe/manage/:token", async (c) => {
    assertSameOrigin(c.req.header("origin"), requestOrigin(c));
    const body = await parseBody(c, subscribePreferencesSchema);
    await updatePreferences(
      c.env,
      c.req.param("token"),
      body.followAll,
      body.monitorIds,
    );
    const view = await manageView(c.env, c.req.param("token"));
    if (!view)
      throw new ApiError(404, "subscribe_token", t("error_subscribe_token"));
    return c.json({
      followAll: view.row.followAll,
      monitorIds: view.monitorIds,
    });
  });

  app.post("/api/public/subscribe/unsubscribe/:token", async (c) => {
    const result = await unsubscribeSubscriber(c.env, c.req.param("token"));
    if (result === "invalid") {
      throw new ApiError(404, "subscribe_token", t("error_subscribe_token"));
    }
    return c.json({ ok: true });
  });

  app.get("/api/status-pages/:id/subscribers", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.read");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const status = c.req.query("status") ?? "";
    const summary = await subscriberSummary(c.env, page.id, q, status);
    const [mail, turnstile, allowHttp] = await Promise.all([
      mailIsConfigured(c.env),
      subscribeTurnstile(c.env),
      allowHttpWebhooks(c.env),
    ]);
    return c.json({
      subscriptions: {
        email: page.subscribeEmail,
        webhook: page.subscribeWebhook,
        rss: page.subscribeRss,
      },
      mailConfigured: mail,
      turnstile: turnstile ? "widget" : "rate_limit",
      allowHttp,
      ...summary,
    });
  });

  app.put("/api/status-pages/:id/subscriptions", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.write");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, subscriptionFlagsSchema);
    const next = {
      email: body.email ?? page.subscribeEmail,
      webhook: body.webhook ?? page.subscribeWebhook,
      rss: body.rss ?? page.subscribeRss,
    };
    await getDb(c.env.DB)
      .update(statusPages)
      .set({
        subscribeEmail: next.email,
        subscribeWebhook: next.webhook,
        subscribeRss: next.rss,
        updatedAt: Date.now(),
      })
      .where(eq(statusPages.id, page.id));
    await audit(
      c.env,
      actor,
      "status_page.subscriptions",
      page.id,
      {
        email: page.subscribeEmail,
        webhook: page.subscribeWebhook,
        rss: page.subscribeRss,
      },
      next,
      clientIp(c),
    );
    return c.json(next);
  });

  app.delete("/api/status-pages/:id/subscribers/:subscriberId", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.write");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const row = await getDb(c.env.DB)
      .select()
      .from(subscribers)
      .where(eq(subscribers.id, c.req.param("subscriberId")))
      .get();
    if (!row || row.statusPageId !== page.id) {
      throw new ApiError(404, "not_found", t("error_not_found"));
    }
    await c.env.DB.prepare(
      "DELETE FROM subscription_deliveries WHERE subscriber_id = ?",
    )
      .bind(row.id)
      .run();
    await c.env.DB.prepare(
      "DELETE FROM subscription_tokens WHERE subscriber_id = ?",
    )
      .bind(row.id)
      .run();
    await getDb(c.env.DB).delete(subscribers).where(eq(subscribers.id, row.id));
    await audit(
      c.env,
      actor,
      "subscriber.remove",
      row.id,
      { pageId: page.id, kind: row.kind, status: row.status, email: row.email },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/status-pages/:id/subscribers.csv", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.read");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const rows = await getDb(c.env.DB)
      .select()
      .from(subscribers)
      .where(eq(subscribers.statusPageId, page.id))
      .limit(2000);
    const lines = [
      "id,kind,status,email,webhook,created_at,confirmed_at,fail_count",
    ];
    for (const row of rows) {
      let webhook = "";
      if (row.webhookUrlEncrypted && c.env.ENCRYPTION_KEY) {
        try {
          webhook = await decryptString(
            c.env.ENCRYPTION_KEY,
            row.webhookUrlEncrypted,
          );
        } catch {
          webhook = "";
        }
      }
      lines.push(
        [
          row.id,
          row.kind,
          row.status,
          row.email ?? "",
          webhook,
          String(row.createdAt),
          row.confirmedAt ? String(row.confirmedAt) : "",
          String(row.failCount),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=subscribers.csv",
        "cache-control": "private, no-store",
      },
    });
  });
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

async function subscriberSummary(
  env: Env,
  pageId: string,
  q: string,
  status: string,
): Promise<{
  counts: { pending: number; confirmed: number; disabled: number };
  backlog: number;
  subscribers: {
    id: string;
    kind: string;
    status: string;
    email: string | null;
    label: string;
    createdAt: number;
    confirmedAt: number | null;
    failCount: number;
  }[];
}> {
  const countsRow = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
       SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled
     FROM subscribers WHERE status_page_id = ?`,
  )
    .bind(pageId)
    .first<{
      pending: number | null;
      confirmed: number | null;
      disabled: number | null;
    }>();
  const backlogRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM subscription_deliveries
     WHERE status_page_id = ? AND status = 'pending'`,
  )
    .bind(pageId)
    .first<{ n: number }>();
  const filters = ["status_page_id = ?"];
  const binds: (string | number)[] = [pageId];
  if (status === "pending" || status === "confirmed" || status === "disabled") {
    filters.push("status = ?");
    binds.push(status);
  }
  if (q) {
    filters.push("lower(coalesce(email, '')) LIKE ?");
    binds.push(`%${q.replaceAll("%", "")}%`);
  }
  const listed = await env.DB.prepare(
    `SELECT id, kind, status, email, webhook_url_encrypted, created_at, confirmed_at, fail_count
     FROM subscribers
     WHERE ${filters.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 100`,
  )
    .bind(...binds)
    .all<{
      id: string;
      kind: string;
      status: string;
      email: string | null;
      webhook_url_encrypted: string | null;
      created_at: number;
      confirmed_at: number | null;
      fail_count: number;
    }>();
  const items = [];
  for (const row of listed.results) {
    let label = row.email ?? t("subscribe_kind_webhook");
    if (
      row.kind === "webhook" &&
      row.webhook_url_encrypted &&
      env.ENCRYPTION_KEY
    ) {
      try {
        label = new URL(
          await decryptString(env.ENCRYPTION_KEY, row.webhook_url_encrypted),
        ).host;
      } catch {
        label = t("subscribe_kind_webhook");
      }
    }
    items.push({
      id: row.id,
      kind: row.kind,
      status: row.status,
      email: row.email,
      label,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      failCount: row.fail_count,
    });
  }
  return {
    counts: {
      pending: Number(countsRow?.pending ?? 0),
      confirmed: Number(countsRow?.confirmed ?? 0),
      disabled: Number(countsRow?.disabled ?? 0),
    },
    backlog: Number(backlogRow?.n ?? 0),
    subscribers: items,
  };
}
