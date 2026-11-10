// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { utcDayStart } from "../shared/history";
import { api, ownerSession } from "./helpers";

async function organizationId(): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT organization_id FROM memberships LIMIT 1",
  ).first<{ organization_id: string }>();
  if (!row) throw new Error("no organization");
  return row.organization_id;
}

/** Rows only: these tests read monitors, they never run a check. */
async function seedMonitors(prefix: string, count: number): Promise<string[]> {
  const org = await organizationId();
  const now = Date.now();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    ids.push(id);
    await env.DB.prepare(
      `INSERT INTO monitors (
        id, organization_id, name, type, config_json, interval_seconds,
        timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
        paused, created_at, updated_at
      ) VALUES (?, ?, ?, 'heartbeat', '{"graceSeconds":30}', 60, 10, 2, 1, '["default"]', ?, 0, ?, ?)`,
    )
      .bind(id, org, `${prefix}-${index}`, `seed-${prefix}`, now, now)
      .run();
  }
  return ids;
}

async function createPage(
  owner: string,
  slug: string,
  monitorIds: string[],
  published = true,
): Promise<string> {
  const page = await api(
    "/api/status-pages",
    {
      method: "POST",
      body: JSON.stringify({
        slug,
        published,
        title: slug,
        description: "",
        items: monitorIds.map((monitorId, position) => ({
          monitorId,
          position,
          groupName: "",
          displayName: "",
        })),
      }),
    },
    owner,
  );
  expect(page.status, await page.clone().text()).toBe(201);
  return ((await page.json()) as { id: string }).id;
}

function incidentBody(
  monitorIds: string[],
  pageIds: string[],
  postedAt = Date.now(),
) {
  return JSON.stringify({
    title: "Elevated errors",
    notify: false,
    channelIds: [],
    pageIds,
    monitors: monitorIds.map((monitorId, index) => ({
      monitorId,
      impact: index === 0 ? "degraded" : "major_outage",
    })),
    update: { status: "investigating", body: "Looking into it.", postedAt },
  });
}

describe("D1 parameter limit", () => {
  it("stores an incident with the 50 monitors the schema allows", async () => {
    const owner = await ownerSession();
    const ids = await seedMonitors("fifty", 50);
    const created = await api(
      "/api/incidents",
      { method: "POST", body: incidentBody(ids, []) },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const links = await env.DB.prepare(
      "SELECT count(*) AS n FROM incident_monitors WHERE incident_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(links?.n).toBe(50);
  });

  it("stores a maintenance window with the 50 monitors the schema allows", async () => {
    const owner = await ownerSession();
    const ids = await seedMonitors("window", 50);
    const start = Date.now() + 3_600_000;
    const created = await api(
      "/api/maintenance",
      {
        method: "POST",
        body: JSON.stringify({
          title: "Upgrade",
          description: "",
          notify: false,
          channelIds: [],
          pageIds: [],
          monitorIds: ids,
          startAt: start,
          endAt: start + 3_600_000,
          timezone: "UTC",
          recurrence: "once",
          weekdays: [],
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const links = await env.DB.prepare(
      "SELECT count(*) AS n FROM maintenance_monitors WHERE maintenance_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(links?.n).toBe(50);
  });

  it("serves a public page with 120 items", async () => {
    const owner = await ownerSession();
    const ids = await seedMonitors("wide", 120);
    await createPage(owner, "wide-page", ids);
    const page = await api("/api/public/status/wide-page");
    expect(page.status, await page.clone().text()).toBe(200);
    const body = (await page.json()) as {
      groups: { items: unknown[] }[];
    };
    expect(body.groups.flatMap((group) => group.items)).toHaveLength(120);
  });
});

describe("public incident detail", () => {
  it("lists only the monitors the page shows", async () => {
    const owner = await ownerSession();
    const [shown, hidden] = await seedMonitors("leak", 2);
    if (!shown || !hidden) throw new Error("seed failed");
    const pageId = await createPage(owner, "leak-page", [shown]);
    const created = await api(
      "/api/incidents",
      { method: "POST", body: incidentBody([shown, hidden], [pageId]) },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const detail = await api(`/api/public/status/leak-page/incidents/${id}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      incident: { impact: string; monitors: { name: string }[] };
    };
    expect(body.incident.monitors.map((row) => row.name)).toEqual(["leak-0"]);
    expect(body.incident.impact).toBe("degraded");
  });
});

describe("incident resolve", () => {
  it("does not announce resolved while a later update keeps it open", async () => {
    const owner = await ownerSession();
    const ids = await seedMonitors("resolve", 1);
    const created = await api(
      "/api/incidents",
      {
        method: "POST",
        body: incidentBody(ids, [], Date.now() + 120_000),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const resolved = await api(
      `/api/incidents/${id}/resolve`,
      { method: "POST", body: JSON.stringify({ body: "Fixed." }) },
      owner,
    );
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    const row = await env.DB.prepare(
      "SELECT resolved_at FROM incidents WHERE id = ?",
    )
      .bind(id)
      .first<{ resolved_at: number | null }>();
    expect(row?.resolved_at).toBeNull();
    const events = await env.DB.prepare(
      "SELECT kind FROM announcement_events WHERE subject_id = ? ORDER BY created_at",
    )
      .bind(id)
      .all<{ kind: string }>();
    expect(events.results.map((event) => event.kind)).not.toContain(
      "incident.resolved",
    );
  });
});

describe("monitor stats", () => {
  it("counts a rolled day once", async () => {
    const owner = await ownerSession();
    const [id] = await seedMonitors("stats", 1);
    if (!id) throw new Error("seed failed");
    const today = utcDayStart(Date.now());
    const yesterday = today - 86_400_000;
    await env.DB.prepare(
      `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json)
       VALUES (?, ?, 50, 50, 0, 0, '[]'), (?, ?, 100, 0, 0, 0, '[]')`,
    )
      .bind(id, yesterday + 3_600_000, id, today)
      .run();
    await env.DB.prepare(
      `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max)
       VALUES (?, ?, 50, 50, 0, 0)`,
    )
      .bind(id, yesterday)
      .run();
    const stats = await api(`/api/monitors/${id}/stats`, {}, owner);
    expect(stats.status, await stats.clone().text()).toBe(200);
    const body = (await stats.json()) as {
      uptime: { d7: number; d30: number; d90: number };
    };
    expect(body.uptime).toMatchObject({ d7: 75, d30: 75, d90: 75 });
  });
});
