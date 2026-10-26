// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../worker/crypto/secret";
import { pruneHistory } from "../worker/retention";
import {
  drainSubscriptions,
  fanoutSubscriptions,
} from "../worker/subscribe/deliver";
import { setOutboundFetch } from "../worker/subscribe/webhook";
import { api, ownerSession } from "./helpers";

function mockOutbound(failWebhook: () => boolean): void {
  setOutboundFetch(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://cloudflare-dns.com/")) {
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: "93.184.216.34" }],
      });
    }
    if (url.startsWith("https://hooks.example/")) {
      return new Response(null, { status: failWebhook() ? 500 : 204 });
    }
    return new Response("unexpected", { status: 599 });
  });
}

async function ensureMail(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mail_settings (id, driver, from_name, from_address, updated_at)
     VALUES (1, 'test', 'Flarebot', 'bot@example.com', ?)
     ON CONFLICT(id) DO UPDATE SET driver = 'test', from_address = 'bot@example.com'`,
  )
    .bind(Date.now())
    .run();
}

async function heartbeat(owner: string, name: string): Promise<string> {
  const created = await api(
    "/api/monitors",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        type: "heartbeat",
        config: { graceSeconds: 30 },
        intervalSeconds: 60,
        timeoutSeconds: 10,
        retries: 2,
        recoveryThreshold: 1,
      }),
    },
    owner,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function publishPage(
  owner: string,
  slug: string,
  monitorId: string,
): Promise<string> {
  const page = await api(
    "/api/status-pages",
    {
      method: "POST",
      body: JSON.stringify({
        slug,
        published: true,
        title: `Public ${slug}`,
        description: "Services",
        items: [
          {
            monitorId,
            position: 0,
            groupName: "Core",
            displayName: "Heartbeat",
          },
        ],
      }),
    },
    owner,
  );
  expect(page.status, await page.clone().text()).toBe(201);
  return ((await page.json()) as { id: string }).id;
}

describe("visitor subscriptions", () => {
  it("confirms email, keeps only hashes, fans out, and does not delete the subscriber", async () => {
    await ensureMail();
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Sub beat ${suffix}`);
    const slug = `sub-${suffix}`;
    const pageId = await publishPage(owner, slug, monitorId);
    const flags = await api(
      `/api/status-pages/${pageId}/subscriptions`,
      {
        method: "PUT",
        body: JSON.stringify({ email: true, webhook: true, rss: true }),
      },
      owner,
    );
    expect(flags.status, await flags.clone().text()).toBe(200);

    const email = `visitor-${suffix}@example.com`;
    const subscribed = await api("/api/public/subscribe", {
      method: "POST",
      body: JSON.stringify({
        slug,
        kind: "email",
        email,
        followAll: true,
      }),
    });
    expect(subscribed.status, await subscribed.clone().text()).toBe(200);
    const mail = await env.DB.prepare(
      "SELECT text_body AS text, headers_json AS headers FROM mail_outbox WHERE to_address = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(email)
      .first<{ text: string; headers: string }>();
    expect(mail?.text).toContain("/subscribe/confirm/");
    expect(mail?.headers).toContain("List-Unsubscribe");
    expect(mail?.headers).toContain("List-Unsubscribe-Post");
    const confirm = /\/subscribe\/confirm\/([^/\s]+)/.exec(
      mail?.text ?? "",
    )?.[1];
    const unsub = /\/subscribe\/unsubscribe\/([^/\s]+)/.exec(
      mail?.text ?? "",
    )?.[1];
    expect(confirm).toBeTruthy();
    expect(unsub).toBeTruthy();
    const stored = await env.DB.prepare(
      "SELECT confirm_token_hash AS confirmHash, email, webhook_url_encrypted AS url FROM subscribers WHERE email = ?",
    )
      .bind(email)
      .first<{ confirmHash: string; email: string; url: string | null }>();
    expect(stored?.confirmHash).toBe(await sha256Hex(confirm ?? ""));
    expect(JSON.stringify(stored)).not.toContain(confirm);
    const tokenRow = await env.DB.prepare(
      "SELECT token_hash AS hash FROM subscription_tokens WHERE token_hash = ?",
    )
      .bind(await sha256Hex(confirm ?? ""))
      .first<{ hash: string }>();
    expect(tokenRow?.hash).toBe(await sha256Hex(confirm ?? ""));

    const page = await api(`/subscribe/confirm/${confirm}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Subscription confirmed");

    const created = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Notice ${suffix}`,
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "degraded" }],
          update: {
            status: "investigating",
            body: "Looking",
            postedAt: Date.now(),
          },
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    expect(await fanoutSubscriptions(env)).toBe(1);
    expect(await drainSubscriptions(env)).toBe(1);
    const notice = await env.DB.prepare(
      "SELECT text_body AS text, headers_json AS headers FROM mail_outbox WHERE to_address = ? AND text_body LIKE ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(email, `%Notice ${suffix}%`)
      .first<{ text: string; headers: string }>();
    expect(notice?.text).toContain(`Notice ${suffix}`);
    expect(notice?.headers).toContain("List-Unsubscribe");

    const removed = await api(`/api/public/subscribe/unsubscribe/${unsub}`, {
      method: "POST",
    });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const status = await env.DB.prepare(
      "SELECT status FROM subscribers WHERE email = ?",
    )
      .bind(email)
      .first<{ status: string }>();
    expect(status?.status).toBe("disabled");

    const deliveryId = crypto.randomUUID();
    const subscriberId = (
      await env.DB.prepare("SELECT id FROM subscribers WHERE email = ?")
        .bind(email)
        .first<{ id: string }>()
    )?.id;
    await env.DB.prepare(
      `INSERT INTO subscription_deliveries (
        id, status_page_id, subscriber_id, event_id, status, attempts,
        next_attempt_at, last_error, created_at, sent_at
      ) VALUES (?, ?, ?, ?, 'sent', 1, ?, NULL, ?, ?)`,
    )
      .bind(deliveryId, pageId, subscriberId, crypto.randomUUID(), 1, 1, 1)
      .run();
    await env.DB.prepare("DELETE FROM settings WHERE key = ?")
      .bind("history_prune_state")
      .run();
    const pruned = await pruneHistory(env, Date.now());
    expect(pruned.deliveries).toBeGreaterThan(0);
    const still = await env.DB.prepare(
      "SELECT id FROM subscribers WHERE email = ?",
    )
      .bind(email)
      .first();
    expect(still).toBeTruthy();
    const gone = await env.DB.prepare(
      "SELECT id FROM subscription_deliveries WHERE id = ?",
    )
      .bind(deliveryId)
      .first();
    expect(gone).toBeNull();

    const listed = await api(
      `/api/status-pages/${pageId}/subscribers?q=${encodeURIComponent(email)}`,
      {},
      owner,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      counts: { disabled: number };
      backlog: number;
      subscribers: { email: string | null; status: string }[];
    };
    expect(body.subscribers.some((row) => row.status === "disabled")).toBe(
      true,
    );
    const removedRow = await api(
      `/api/status-pages/${pageId}/subscribers/${subscriberId}`,
      { method: "DELETE" },
      owner,
    );
    expect(removedRow.status).toBe(200);
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action = 'subscriber.remove' AND target = ?",
    )
      .bind(subscriberId)
      .first<{ action: string }>();
    expect(audit?.action).toBe("subscriber.remove");
  });

  it("hides email without mail, blocks private webhooks, and rate limits", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Limit ${suffix}`);
    const slug = `lim-${suffix}`;
    const pageId = await publishPage(owner, slug, monitorId);
    await api(
      `/api/status-pages/${pageId}/subscriptions`,
      {
        method: "PUT",
        body: JSON.stringify({ email: true, webhook: true, rss: false }),
      },
      owner,
    );
    await env.DB.prepare(
      "UPDATE mail_settings SET driver = 'none' WHERE id = 1",
    ).run();
    try {
      const hidden = (await (
        await api(`/api/public/status/${slug}`)
      ).json()) as { subscriptions: { email: boolean; webhook: boolean } };
      expect(hidden.subscriptions.email).toBe(false);
      expect(hidden.subscriptions.webhook).toBe(true);
      const denied = await api("/api/public/subscribe", {
        method: "POST",
        body: JSON.stringify({
          slug,
          kind: "email",
          email: `off-${suffix}@example.com`,
          followAll: true,
        }),
      });
      expect(denied.status).toBe(400);
    } finally {
      await ensureMail();
    }

    const local = await api("/api/public/subscribe", {
      method: "POST",
      body: JSON.stringify({
        slug,
        kind: "webhook",
        webhookUrl: "https://127.0.0.1/hook",
        followAll: true,
      }),
    });
    expect(local.status).toBe(400);
    const http = await api("/api/public/subscribe", {
      method: "POST",
      body: JSON.stringify({
        slug,
        kind: "webhook",
        webhookUrl: "http://example.com/hook",
        followAll: true,
      }),
    });
    expect(http.status).toBe(400);

    await ensureMail();
    await api(
      `/api/status-pages/${pageId}/subscriptions`,
      { method: "PUT", body: JSON.stringify({ email: true }) },
      owner,
    );
    const address = `rate-${suffix}@example.com`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await api("/api/public/subscribe", {
        method: "POST",
        body: JSON.stringify({
          slug,
          kind: "email",
          email: address,
          followAll: true,
        }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const limited = await api("/api/public/subscribe", {
      method: "POST",
      body: JSON.stringify({
        slug,
        kind: "email",
        email: address,
        followAll: true,
      }),
    });
    expect(limited.status).toBe(429);
  });

  it("serves cached rss and atom for the page", async () => {
    await ensureMail();
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Feed ${suffix}`);
    const slug = `feed-${suffix}`;
    const pageId = await publishPage(owner, slug, monitorId);
    const off = await api(`/s/${slug}/feed.rss`);
    expect(off.status).toBe(404);
    await api(
      `/api/status-pages/${pageId}/subscriptions`,
      { method: "PUT", body: JSON.stringify({ rss: true }) },
      owner,
    );
    await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Feed item ${suffix}`,
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "degraded" }],
          update: {
            status: "investigating",
            body: "Down",
            postedAt: Date.now(),
          },
        }),
      },
      owner,
    );
    const rss = await api(`/s/${slug}/feed.rss`);
    expect(rss.status).toBe(200);
    expect(rss.headers.get("content-type")).toContain("rss");
    expect(rss.headers.get("cache-control")).toContain("max-age=60");
    expect(await rss.text()).toContain(`Feed item ${suffix}`);
    const atom = await api(`/s/${slug}/feed.atom`);
    expect(atom.status).toBe(200);
    expect(await atom.text()).toContain("http://www.w3.org/2005/Atom");
  });

  it("verifies a webhook, encrypts the URL, and disables it after failures", async () => {
    let failWebhook = false;
    mockOutbound(() => failWebhook);
    try {
      const owner = await ownerSession();
      const suffix = crypto.randomUUID().slice(0, 8);
      const monitorId = await heartbeat(owner, `Hook ${suffix}`);
      const slug = `hook-${suffix}`;
      const pageId = await publishPage(owner, slug, monitorId);
      await api(
        `/api/status-pages/${pageId}/subscriptions`,
        { method: "PUT", body: JSON.stringify({ webhook: true }) },
        owner,
      );
      const subscribed = await api("/api/public/subscribe", {
        method: "POST",
        body: JSON.stringify({
          slug,
          kind: "webhook",
          webhookUrl: `https://hooks.example/hook?s=${suffix}`,
          followAll: false,
          monitorIds: [monitorId],
        }),
      });
      expect(subscribed.status, await subscribed.clone().text()).toBe(200);
      const body = (await subscribed.json()) as { secret: string };
      expect(body.secret.length).toBeGreaterThan(20);
      const row = await env.DB.prepare(
        `SELECT status, webhook_url_encrypted AS url, webhook_secret_encrypted AS secret
       FROM subscribers WHERE status_page_id = ? AND kind = 'webhook'`,
      )
        .bind(pageId)
        .first<{ status: string; url: string; secret: string }>();
      expect(row?.status).toBe("confirmed");
      expect(row?.url).not.toContain("hooks.example");
      expect(row?.secret).not.toContain(body.secret);

      failWebhook = true;
      const created = await api(
        "/api/incidents",
        {
          method: "POST",
          body: JSON.stringify({
            title: `Hook notice ${suffix}`,
            notify: false,
            channelIds: [],
            pageIds: [pageId],
            monitors: [{ monitorId, impact: "degraded" }],
            update: {
              status: "investigating",
              body: "Down",
              postedAt: Date.now(),
            },
          }),
        },
        owner,
      );
      expect(created.status, await created.clone().text()).toBe(201);
      let queued = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        queued += await fanoutSubscriptions(env);
        const pending = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM subscription_deliveries WHERE status_page_id = ?",
        )
          .bind(pageId)
          .first<{ n: number }>();
        if ((pending?.n ?? 0) > 0) break;
      }
      expect(queued).toBeGreaterThan(0);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await drainSubscriptions(env);
        await env.DB.prepare(
          "UPDATE subscription_deliveries SET next_attempt_at = 0 WHERE status = 'pending'",
        ).run();
      }
      const disabled = await env.DB.prepare(
        "SELECT status, fail_count AS fails FROM subscribers WHERE status_page_id = ? AND kind = 'webhook'",
      )
        .bind(pageId)
        .first<{ status: string; fails: number }>();
      expect(disabled?.status).toBe("disabled");
      expect(disabled?.fails).toBeGreaterThanOrEqual(5);
    } finally {
      setOutboundFetch(null);
    }
  });
});
