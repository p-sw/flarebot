// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DAY_MS, utcDayStart } from "../shared/history";
import { createApp } from "../worker/app";
import { api, cookieFrom, origin, ownerSession } from "./helpers";

const app = createApp();

async function cachedGet(
  path: string,
  headers?: HeadersInit,
): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {
      return undefined;
    },
  };
  const requestHeaders = new Headers(headers);
  requestHeaders.set("origin", origin);
  const response = await app.request(
    `${origin}${path}`,
    { headers: requestHeaders },
    env,
    ctx as ExecutionContext,
  );
  await Promise.all(pending);
  return response;
}

async function createMonitor(owner: string, name: string): Promise<string> {
  const created = await api(
    "/api/monitors",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        type: "heartbeat",
        config: { graceSeconds: 30 },
        intervalSeconds: 60,
      }),
    },
    owner,
  );
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function publish(owner: string, monitorId: string, published: boolean) {
  const slug = `badge-${crypto.randomUUID().slice(0, 8)}`;
  const response = await api(
    "/api/status-pages",
    {
      method: "POST",
      body: JSON.stringify({
        slug,
        published,
        title: slug,
        description: "",
        items: [
          {
            monitorId,
            position: 0,
            groupName: "",
            displayName: "",
          },
        ],
      }),
    },
    owner,
  );
  expect(response.status).toBe(201);
  return slug;
}

describe("public badges", () => {
  it("returns the same unknown badge for a missing id and a private monitor", async () => {
    const owner = await ownerSession();
    const id = await createMonitor(owner, "Private badge");
    await publish(owner, id, false);
    const label = encodeURIComponent("a<b");
    const missing = await api(
      `/badge/${crypto.randomUUID()}/status.svg?label=${label}`,
    );
    const hidden = await api(`/badge/${id}/status.svg?label=${label}`);
    const junk = await api(`/badge/not-a-monitor/uptime.svg?label=${label}`);
    expect(missing.status).toBe(200);
    expect(hidden.status).toBe(200);
    expect(junk.status).toBe(200);
    expect(missing.headers.get("content-type")).toContain("image/svg+xml");
    expect(missing.headers.get("cache-control")).toBe("public, max-age=120");
    expect(missing.headers.get("etag")).toBeTruthy();
    const missingBody = await missing.text();
    expect(await hidden.text()).toBe(missingBody);
    expect(missingBody).toContain("unknown");
    expect(missingBody).toContain("&lt;");
    expect(missingBody).not.toContain("<b");
    expect(JSON.stringify(missingBody)).not.toContain("Private badge");
    const detail = (await (
      await api(`/api/monitors/${id}`, {}, owner)
    ).json()) as { badgesEnabled: boolean; badgesPublic: boolean };
    expect(detail.badgesEnabled).toBe(false);
    expect(detail.badgesPublic).toBe(false);
  });

  it("serves status, uptime, and response time once a monitor is public", async () => {
    const owner = await ownerSession();
    const id = await createMonitor(owner, "Public badge");
    await env.DB.prepare(
      "UPDATE monitor_state SET status = 'up' WHERE monitor_id = ?",
    )
      .bind(id)
      .run();
    await publish(owner, id, true);
    const status = await api(`/badge/${id.toUpperCase()}/status.svg`);
    expect(status.status).toBe(200);
    const statusBody = await status.text();
    expect(statusBody).toContain(">up<");
    expect(statusBody).toContain('fill="#4c1"');
    expect(statusBody).not.toContain(">unknown<");

    const yesterday = utcDayStart(Date.now()) - DAY_MS;
    await env.DB.prepare(
      `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max)
       VALUES (?, ?, 80, 20, 1000, 40)`,
    )
      .bind(id, yesterday)
      .run();
    const uptime = await api(
      `/badge/${id}/uptime.svg?window=7d&style=flat-square`,
    );
    const uptimeBody = await uptime.text();
    expect(uptimeBody).toContain("uptime 7d");
    expect(uptimeBody).toContain("%");
    expect(uptimeBody).not.toContain("linearGradient");
    const percent = Number(/>(\d+(?:\.\d+)?)%</.exec(uptimeBody)?.[1]);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThanOrEqual(100);

    const response = await api(
      `/badge/${id}/response.svg?window=7d&style=for-the-badge`,
    );
    const responseBody = await response.text();
    expect(responseBody).toContain("RESPONSE 7D");
    expect(responseBody).toContain("MS");
    expect(responseBody).toContain('height="28"');

    const detail = (await (
      await api(`/api/monitors/${id}`, {}, owner)
    ).json()) as { badgesEnabled: boolean; badgesPublic: boolean };
    expect(detail.badgesEnabled).toBe(false);
    expect(detail.badgesPublic).toBe(true);
  });

  it("clamps a long window to retention and caches the rendered badge", async () => {
    const owner = await ownerSession();
    const saved = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ historyRetentionDays: 7 }) },
      owner,
    );
    expect(saved.status).toBe(200);
    try {
      const id = await createMonitor(owner, "Clamped badge");
      await env.DB.prepare(
        "UPDATE monitors SET badges_enabled = 1 WHERE id = ?",
      )
        .bind(id)
        .run();
      await env.DB.prepare(
        "UPDATE monitor_state SET status = 'up' WHERE monitor_id = ?",
      )
        .bind(id)
        .run();
      const old = utcDayStart(Date.now()) - 30 * DAY_MS;
      const recent = utcDayStart(Date.now()) - DAY_MS;
      await env.DB.prepare(
        `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max)
         VALUES (?, ?, 0, 10000, 0, 0)`,
      )
        .bind(id, old)
        .run();
      await env.DB.prepare(
        `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max)
         VALUES (?, ?, 100, 0, 500, 20)`,
      )
        .bind(id, recent)
        .run();
      const uptime = await cachedGet(`/badge/${id}/uptime.svg?window=90d`);
      const uptimeBody = await uptime.text();
      expect(uptimeBody).toContain("uptime 7d");
      expect(uptimeBody).not.toContain("uptime 90d");
      const percent = Number(/>(\d+(?:\.\d+)?)%</.exec(uptimeBody)?.[1]);
      expect(percent).toBeGreaterThanOrEqual(90);

      const cached = await cachedGet(`/badge/${id}/status.svg`);
      expect(await cached.text()).toContain(">up<");
      const etag = cached.headers.get("etag");
      expect(etag).toBeTruthy();
      await env.DB.prepare(
        "UPDATE monitor_state SET status = 'down' WHERE monitor_id = ?",
      )
        .bind(id)
        .run();
      const again = await cachedGet(`/badge/${id}/status.svg`);
      expect(await again.text()).toContain(">up<");
      const busted = await cachedGet(`/badge/${id}/status.svg?cachebust=1`);
      expect(await busted.text()).toContain(">up<");
      const changed = await cachedGet(
        `/badge/${id}/status.svg?style=flat-square`,
      );
      expect(await changed.text()).toContain(">down<");
      const revalidated = await cachedGet(`/badge/${id}/status.svg`, {
        "if-none-match": etag ?? "",
      });
      expect(revalidated.status).toBe(304);
      expect(await revalidated.text()).toBe("");
    } finally {
      await api(
        "/api/settings",
        { method: "PUT", body: JSON.stringify({ historyRetentionDays: 90 }) },
        owner,
      );
    }
  });

  it("lets an editor enable badges and records an audit entry", async () => {
    const owner = await ownerSession();
    const id = await createMonitor(owner, "Toggle badge");
    const email = `badge-viewer-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const invite = await api(
      "/api/team/invites",
      {
        method: "POST",
        body: JSON.stringify({ role: "viewer", email }),
      },
      owner,
    );
    expect(invite.status).toBe(201);
    const token =
      ((await invite.json()) as { link: string }).link.split("/").pop() ?? "";
    const accepted = await api("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name: "Viewer",
        email,
        password: "correct-horse",
      }),
    });
    expect(accepted.status).toBe(201);
    const viewer = cookieFrom(accepted);
    const denied = await api(
      `/api/monitors/${id}/badges`,
      { method: "PATCH", body: JSON.stringify({ enabled: true }) },
      viewer,
    );
    expect(denied.status).toBe(403);

    const enabled = await api(
      `/api/monitors/${id}/badges`,
      { method: "PATCH", body: JSON.stringify({ enabled: true }) },
      owner,
    );
    expect(enabled.status).toBe(200);
    const body = (await enabled.json()) as {
      badgesEnabled: boolean;
      badgesPublic: boolean;
    };
    expect(body.badgesEnabled).toBe(true);
    expect(body.badgesPublic).toBe(true);
    const events = (
      (await (await api("/api/audit", {}, owner)).json()) as {
        events: { action: string; target: string | null }[];
      }
    ).events;
    expect(
      events.some(
        (event) => event.action === "monitor.badges" && event.target === id,
      ),
    ).toBe(true);

    const renamed = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Toggle badge renamed",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
          timeoutSeconds: 10,
          retries: 2,
          recoveryThreshold: 1,
          channelIds: [],
          paused: false,
        }),
      },
      owner,
    );
    expect(renamed.status).toBe(200);
    expect(
      ((await renamed.json()) as { badgesEnabled: boolean }).badgesEnabled,
    ).toBe(true);

    const preview = await api(
      `/api/monitors/${id}/badges/preview.svg?kind=status`,
      {},
      owner,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toContain("no-store");
    expect(await preview.text()).toContain("svg");
    const missingPreview = await api(
      `/api/monitors/${crypto.randomUUID()}/badges/preview.svg?kind=status`,
      {},
      owner,
    );
    expect(missingPreview.status).toBe(404);
  });
});
