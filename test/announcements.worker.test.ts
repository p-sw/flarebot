// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  HISTORY_PRUNE_STATE_KEY,
  HISTORY_RETENTION_KEY,
  retentionCutoff,
} from "../shared/history";
import { drainAnnouncements } from "../worker/announce/drain";
import { schedulerStub } from "../worker/monitors/sync";
import { pruneHistory } from "../worker/retention";
import { writeSetting } from "../worker/settings-store";
import { api, cookieFrom, ownerSession } from "./helpers";

async function ensureMail(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mail_settings (id, driver, from_name, from_address, updated_at)
     VALUES (1, 'test', 'Flarebot', 'bot@example.com', ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(Date.now())
    .run();
}

async function invite(
  owner: string,
  role: "editor" | "viewer",
  email: string,
): Promise<string> {
  const sent = await api(
    "/api/team/invites",
    { method: "POST", body: JSON.stringify({ role, email }) },
    owner,
  );
  expect(sent.status, await sent.clone().text()).toBe(201);
  const token =
    ((await sent.json()) as { link: string }).link.split("/").pop() ?? "";
  const accepted = await api("/api/invites/accept", {
    method: "POST",
    body: JSON.stringify({
      token,
      name: role,
      email,
      password: "correct-horse",
    }),
  });
  expect(accepted.status, await accepted.clone().text()).toBe(201);
  return cookieFrom(accepted);
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
        title: "Public",
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

type PublicStatus = {
  overall: string;
  incidents: { id: string; title: string; status: string }[];
  history: { id: string; title: string }[];
  maintenance: { id: string; title: string; state: string }[];
  groups: {
    items: {
      status: string;
      maint: number;
      bars: { state: string; maint: number }[];
    }[];
  }[];
};

describe("incidents and maintenance", () => {
  it("lets an editor publish an incident, blocks a viewer, and delivers the announcement", async () => {
    const owner = await ownerSession();
    await ensureMail();
    const suffix = crypto.randomUUID().slice(0, 8);
    const editor = await invite(owner, "editor", `ed-${suffix}@example.com`);
    const viewer = await invite(owner, "viewer", `vw-${suffix}@example.com`);
    const channel = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Ops ${suffix}`,
          type: "email",
          config: { to: "ops@example.com" },
        }),
      },
      owner,
    );
    expect(channel.status).toBe(201);
    const channelId = ((await channel.json()) as { id: string }).id;
    const monitorId = await heartbeat(owner, `Beat ${suffix}`);
    const slug = `inc-${suffix}`;
    const pageId = await publishPage(owner, slug, monitorId);
    const now = Date.now();
    const denied = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Viewer",
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "degraded" }],
          update: {
            status: "investigating",
            body: "no",
            postedAt: now,
          },
        }),
      },
      viewer,
    );
    expect(denied.status).toBe(403);

    const created = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Api ${suffix}`,
          notify: true,
          channelIds: [channelId],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "major_outage" }],
          update: {
            status: "investigating",
            body: "Looking at **latency**.",
            postedAt: now,
          },
        }),
      },
      editor,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const incident = (await created.json()) as {
      id: string;
      updates: { id: string }[];
    };
    const last = await api(
      `/api/incidents/${incident.id}/updates/${incident.updates[0]?.id}`,
      { method: "DELETE" },
      editor,
    );
    expect(last.status).toBe(400);

    const listed = await api("/api/incidents?state=active", {}, viewer);
    expect(listed.status).toBe(200);
    const titles = (
      (await listed.json()) as { incidents: { title: string }[] }
    ).incidents.map((row) => row.title);
    expect(titles).toContain(`Api ${suffix}`);

    const status = (await (
      await api(`/api/public/status/${slug}`)
    ).json()) as PublicStatus;
    expect(status.incidents.some((row) => row.title === `Api ${suffix}`)).toBe(
      true,
    );
    expect(status.groups[0]?.items[0]?.status).toBe("major_outage");
    expect(status.overall).toBe("outage");

    const detail = await api(
      `/api/public/status/${slug}/incidents/${incident.id}`,
    );
    expect(detail.status).toBe(200);
    const timeline = (await detail.json()) as {
      incident: { updates: { body: string; status: string }[] };
    };
    expect(timeline.incident.updates[0]?.body).toContain("**latency**");

    const events = await env.DB.prepare(
      "SELECT kind FROM announcement_events WHERE subject_id = ?",
    )
      .bind(incident.id)
      .all<{ kind: string }>();
    expect(events.results.map((row) => row.kind)).toContain("incident.created");
    const queued = await env.DB.prepare(
      `SELECT o.status FROM announcement_outbox o
       INNER JOIN announcement_events e ON e.id = o.event_id
       WHERE e.subject_id = ?`,
    )
      .bind(incident.id)
      .all<{ status: string }>();
    expect(queued.results.length).toBeGreaterThan(0);

    const sent = await drainAnnouncements(env);
    expect(sent).toBeGreaterThan(0);
    const mail = await env.DB.prepare(
      "SELECT kind, subject, status FROM mail_outbox WHERE subject LIKE ?",
    )
      .bind(`%Api ${suffix}%`)
      .all<{ kind: string; subject: string; status: string }>();
    expect(mail.results.some((row) => row.kind === "announcement")).toBe(true);

    const resolved = await api(
      `/api/incidents/${incident.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ body: "Recovered." }),
      },
      editor,
    );
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    const after = (await (
      await api(`/api/public/status/${slug}`)
    ).json()) as PublicStatus;
    expect(after.incidents.some((row) => row.id === incident.id)).toBe(false);
    expect(after.history.some((row) => row.id === incident.id)).toBe(true);
    expect(after.groups[0]?.items[0]?.status).not.toBe("major_outage");
  });

  it("creates one incident from an outage and returns the same row again", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Outage ${suffix}`);
    const slug = `out-${suffix}`;
    await publishPage(owner, slug, monitorId);
    const shard = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(monitorId)
      .first<{ shard_id: string }>();
    if (!shard) throw new Error("monitor missing");
    await schedulerStub(env, shard.shard_id).runDue(Date.now() + 20_000);
    const outages = await api(`/api/monitors/${monitorId}/outages`, {}, owner);
    const open = (
      (await outages.json()) as {
        outages: { id: string; endedAt: number | null }[];
      }
    ).outages.find((row) => row.endedAt === null);
    expect(open?.id).toBeTruthy();
    const first = await api(
      `/api/incidents/from-outage/${open?.id}`,
      { method: "POST" },
      owner,
    );
    expect(first.status, await first.clone().text()).toBe(201);
    const created = (await first.json()) as { id: string; title: string };
    const second = await api(
      `/api/incidents/from-outage/${open?.id}`,
      { method: "POST" },
      owner,
    );
    expect(second.status).toBe(200);
    expect(((await second.json()) as { id: string }).id).toBe(created.id);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM incidents WHERE source_outage_id = ?",
    )
      .bind(open?.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const status = (await (
      await api(`/api/public/status/${slug}`)
    ).json()) as PublicStatus;
    expect(status.incidents.some((row) => row.id === created.id)).toBe(true);
  });

  it("keeps checks running during maintenance, skips the alert, and shows the window", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Window ${suffix}`);
    const slug = `mnt-${suffix}`;
    const pageId = await publishPage(owner, slug, monitorId);
    const shard = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(monitorId)
      .first<{ shard_id: string }>();
    if (!shard) throw new Error("monitor missing");
    const before = (await schedulerStub(env, shard.shard_id).getAll()).find(
      (row) => row.id === monitorId,
    );
    const failBefore = before?.rollup?.fail ?? 0;
    const maintBefore = before?.rollup?.maint ?? 0;
    const mailBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM mail_outbox",
    ).first<{ n: number }>();
    const startAt = Date.now() - 60_000;
    const endAt = Date.now() + 3_600_000;
    const created = await api(
      "/api/maintenance",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Window ${suffix}`,
          description: "Database work",
          timezone: "UTC",
          startAt,
          endAt,
          recurrence: "once",
          weekdays: [],
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitorIds: [monitorId],
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const windowId = ((await created.json()) as { id: string }).id;
    const active = await api("/api/maintenance?view=active", {}, owner);
    const activeIds = (
      (await active.json()) as { windows: { id: string }[] }
    ).windows.map((row) => row.id);
    expect(activeIds).toContain(windowId);

    await schedulerStub(env, shard.shard_id).runDue(Date.now() + 20_000);
    const after = (await schedulerStub(env, shard.shard_id).getAll()).find(
      (row) => row.id === monitorId,
    );
    expect(after?.rollup?.fail ?? 0).toBe(failBefore);
    expect(after?.rollup?.maint ?? 0).toBeGreaterThan(maintBefore);
    const mailAfter = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM mail_outbox",
    ).first<{ n: number }>();
    expect(mailAfter?.n ?? 0).toBe(mailBefore?.n ?? 0);

    const status = (await (
      await api(`/api/public/status/${slug}`)
    ).json()) as PublicStatus;
    expect(status.groups[0]?.items[0]?.status).toBe("maintenance");
    expect(status.overall).toBe("maintenance");
    expect(
      status.maintenance.some(
        (row) => row.id === windowId && row.state === "active",
      ),
    ).toBe(true);
    expect((status.groups[0]?.items[0]?.maint ?? 0) > 0).toBe(true);

    const cancelled = await api(
      `/api/maintenance/${windowId}/cancel`,
      { method: "POST" },
      owner,
    );
    expect(cancelled.status).toBe(200);
    expect(
      ((await cancelled.json()) as { cancelledAt: number | null }).cancelledAt,
    ).toBeTruthy();
    const past = await api("/api/maintenance?view=past", {}, owner);
    expect(
      ((await past.json()) as { windows: { id: string }[] }).windows.some(
        (row) => row.id === windowId,
      ),
    ).toBe(true);
  });

  it("prunes resolved incidents and finished maintenance and keeps the audit log", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 8);
    const monitorId = await heartbeat(owner, `Keep ${suffix}`);
    const pageId = await publishPage(owner, `ret-${suffix}`, monitorId);
    const now = Date.now();
    const open = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Open ${suffix}`,
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "degraded" }],
          update: {
            status: "investigating",
            body: "Still open.",
            postedAt: now,
          },
        }),
      },
      owner,
    );
    expect(open.status).toBe(201);
    const openId = ((await open.json()) as { id: string }).id;
    const resolved = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Old ${suffix}`,
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId, impact: "degraded" }],
          update: {
            status: "resolved",
            body: "Done.",
            postedAt: now,
          },
        }),
      },
      owner,
    );
    expect(resolved.status).toBe(201);
    const resolvedId = ((await resolved.json()) as { id: string }).id;
    const once = await api(
      "/api/maintenance",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Once ${suffix}`,
          description: "",
          timezone: "UTC",
          startAt: now + 86_400_000,
          endAt: now + 90_000_000,
          recurrence: "once",
          weekdays: [],
          notify: false,
          channelIds: [],
          pageIds: [],
          monitorIds: [monitorId],
        }),
      },
      owner,
    );
    expect(once.status, await once.clone().text()).toBe(201);
    const onceId = ((await once.json()) as { id: string }).id;
    const repeating = await api(
      "/api/maintenance",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Daily ${suffix}`,
          description: "",
          timezone: "UTC",
          startAt: now + 86_400_000,
          endAt: now + 90_000_000,
          recurrence: "daily",
          weekdays: [],
          notify: false,
          channelIds: [],
          pageIds: [],
          monitorIds: [monitorId],
        }),
      },
      owner,
    );
    expect(repeating.status).toBe(201);
    const repeatingId = ((await repeating.json()) as { id: string }).id;

    const cutoff = retentionCutoff(now, 7);
    await env.DB.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ?")
      .bind(cutoff - 1, resolvedId)
      .run();
    await env.DB.prepare(
      "UPDATE maintenance_windows SET start_at = ?, end_at = ? WHERE id = ?",
    )
      .bind(cutoff - 86_400_000, cutoff - 1, onceId)
      .run();
    await env.DB.prepare(
      "UPDATE maintenance_windows SET start_at = ?, end_at = ? WHERE id = ?",
    )
      .bind(cutoff - 10 * 86_400_000, cutoff - 9 * 86_400_000, repeatingId)
      .run();
    const org = await env.DB.prepare(
      "SELECT organization_id AS organizationId FROM incidents WHERE id = ?",
    )
      .bind(openId)
      .first<{ organizationId: string }>();
    const oldEvent = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO announcement_events (
        id, organization_id, kind, subject_type, subject_id, title, summary, href, created_at
      ) VALUES (?, ?, 'incident.created', 'incident', ?, 'old', '', NULL, ?)`,
    )
      .bind(oldEvent, org?.organizationId, openId, cutoff - 1)
      .run();

    await writeSetting(env, HISTORY_RETENTION_KEY, 7);
    await env.DB.prepare("DELETE FROM settings WHERE key = ?")
      .bind(HISTORY_PRUNE_STATE_KEY)
      .run();
    const result = await pruneHistory(env, now);
    expect(result.skipped).toBe(false);
    expect(result.incidents).toBeGreaterThan(0);
    expect(result.maintenance).toBeGreaterThan(0);
    expect(result.announcements).toBeGreaterThan(0);

    const stillOpen = await env.DB.prepare(
      "SELECT id FROM incidents WHERE id = ?",
    )
      .bind(openId)
      .first();
    expect(stillOpen).toBeTruthy();
    const gone = await env.DB.prepare("SELECT id FROM incidents WHERE id = ?")
      .bind(resolvedId)
      .first();
    expect(gone).toBeNull();
    const onceGone = await env.DB.prepare(
      "SELECT id FROM maintenance_windows WHERE id = ?",
    )
      .bind(onceId)
      .first();
    expect(onceGone).toBeNull();
    const dailyKept = await env.DB.prepare(
      "SELECT id FROM maintenance_windows WHERE id = ?",
    )
      .bind(repeatingId)
      .first();
    expect(dailyKept).toBeTruthy();
    const eventGone = await env.DB.prepare(
      "SELECT id FROM announcement_events WHERE id = ?",
    )
      .bind(oldEvent)
      .first();
    expect(eventGone).toBeNull();
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'incident.create' AND target = ?",
    )
      .bind(openId)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);

    await writeSetting(env, HISTORY_RETENTION_KEY, 90);
    await env.DB.prepare("DELETE FROM settings WHERE key = ?")
      .bind(HISTORY_PRUNE_STATE_KEY)
      .run();
  });
});
