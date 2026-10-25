// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../worker/app";
import { schedulerStub } from "../worker/monitors/sync";

const app = createApp();
const origin = "https://flarebot.test";

async function api(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (cookie) headers.set("cookie", `flarebot_session=${cookie}`);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return app.request(`${origin}${path}`, { ...init, headers }, env);
}

function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = /flarebot_session=([^;]+)/.exec(raw);
  if (!match?.[1]) throw new Error(`missing session cookie: ${raw}`);
  return match[1];
}

describe("flarebot API", () => {
  it("creates an owner, confirms a heartbeat outage, and rejects a viewer write", async () => {
    const health = await api("/api/health");
    expect(health.status).toBe(200);

    const denied = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "wrong-secret",
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect(denied.status).toBe(401);

    const setup = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "test-setup-secret",
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect(setup.status, await setup.clone().text()).toBe(201);
    const owner = cookieFrom(setup);

    const again = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "test-setup-secret",
        name: "Bea",
        email: "bea@example.com",
        password: "correct-horse",
      }),
    });
    expect(again.status).toBe(409);

    await env.DB.prepare(
      "INSERT INTO mail_settings (id, driver, from_name, from_address, updated_at) VALUES (1, 'test', 'Flarebot', 'bot@example.com', ?)",
    )
      .bind(Date.now())
      .run();

    const channel = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Ops",
          type: "email",
          config: { to: "ops@example.com" },
        }),
      },
      owner,
    );
    expect(channel.status).toBe(201);
    const channelId = ((await channel.json()) as { id: string }).id;

    const created = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Heartbeat",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
          timeoutSeconds: 10,
          retries: 2,
          recoveryThreshold: 1,
          channelIds: [channelId],
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const { id, pushUrl } = (await created.json()) as {
      id: string;
      pushUrl: string;
    };
    expect(pushUrl).toContain("/push/hb_");

    const pending = await api(`/api/monitors/${id}`, {}, owner);
    expect(((await pending.json()) as { status: string }).status).toBe(
      "pending",
    );

    const row = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    if (!row) throw new Error("monitor missing");
    await schedulerStub(env, row.shard_id).runDue(Date.now() + 20_000);

    const down = await api(`/api/monitors/${id}`, {}, owner);
    expect(((await down.json()) as { status: string }).status).toBe("down");
    const outages = await api(`/api/monitors/${id}/outages`, {}, owner);
    const open = (
      (await outages.json()) as { outages: { endedAt: number | null }[] }
    ).outages;
    expect(open.some((item) => item.endedAt === null)).toBe(true);

    const mailer = env.MAILER.get(env.MAILER.idFromName("mailer"));
    await mailer.pump();
    const sent = await env.DB.prepare(
      "SELECT status, subject FROM mail_outbox",
    ).all<{ status: string; subject: string }>();
    expect(sent.results.some((item) => item.status === "sent")).toBe(true);

    const pushed = await api(new URL(pushUrl).pathname, { method: "POST" });
    expect(pushed.status).toBe(200);
    await schedulerStub(env, row.shard_id).runDue(Date.now() + 30_000);
    const recovered = await api(`/api/monitors/${id}`, {}, owner);
    expect(((await recovered.json()) as { status: string }).status).toBe("up");

    const invite = await api(
      "/api/team/invites",
      {
        method: "POST",
        body: JSON.stringify({ role: "viewer", email: "view@example.com" }),
      },
      owner,
    );
    expect(invite.status).toBe(201);
    const link = ((await invite.json()) as { link: string }).link;
    const token = link.split("/").pop() ?? "";
    const accepted = await api("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name: "Vic",
        email: "view@example.com",
        password: "correct-horse",
      }),
    });
    expect(accepted.status).toBe(201);
    const viewer = cookieFrom(accepted);
    const forbidden = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Nope",
          type: "heartbeat",
          config: { graceSeconds: 10 },
          intervalSeconds: 60,
        }),
      },
      viewer,
    );
    expect(forbidden.status).toBe(403);

    const minted = await api(
      "/api/tokens",
      {
        method: "POST",
        body: JSON.stringify({ name: "read", scopes: ["read"] }),
      },
      owner,
    );
    expect(minted.status).toBe(201);
    const raw = ((await minted.json()) as { token: string }).token;
    const listed = await api("/api/monitors", {
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(listed.status).toBe(200);
    const deniedWrite = await api("/api/monitors", {
      method: "POST",
      headers: { authorization: `Bearer ${raw}` },
      body: JSON.stringify({
        name: "Token",
        type: "tcp",
        config: { host: "1.1.1.1", port: 443 },
        intervalSeconds: 60,
      }),
    });
    expect(deniedWrite.status).toBe(403);

    const page = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: "main",
          published: true,
          defaultLocale: "en",
          locales: ["en", "ko"],
          sourceLocale: "en",
          title: "Status",
          description: "All services",
          i18n: { ko: { title: "Status KO" } },
          items: [
            {
              monitorId: id,
              position: 0,
              groupName: "Core",
              displayName: "Heartbeat",
              sourceLocale: "en",
              i18n: {},
            },
          ],
        }),
      },
      owner,
    );
    expect(page.status).toBe(201);
    const pub = await api("/api/public/status/main?lang=ko");
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as {
      title: string;
      groups: { items: { status: string }[] }[];
    };
    expect(body.title).toBe("Status KO");
    expect(JSON.stringify(body)).not.toContain("push");
    expect(body.groups[0]?.items[0]?.status).toBe("up");
  });

  it("reports the SMTP stage when the server cannot be reached", async () => {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect(login.status).toBe(200);
    const owner = cookieFrom(login);
    const saved = await api(
      "/api/settings/mail",
      {
        method: "PUT",
        body: JSON.stringify({
          driver: "smtp",
          host: "192.0.2.1",
          port: 587,
          security: "starttls",
          username: "bot",
          password: "secret",
          fromName: "Flarebot",
          fromAddress: "bot@example.com",
        }),
      },
      owner,
    );
    expect(saved.status).toBe(200);
    const test = await api(
      "/api/settings/mail/test",
      { method: "POST", body: JSON.stringify({}) },
      owner,
    );
    expect(test.status).toBe(400);
    const payload = (await test.json()) as { error: { stage?: string } };
    expect(["connect", "tls", "config", "timeout"]).toContain(
      payload.error.stage,
    );
  });
});
