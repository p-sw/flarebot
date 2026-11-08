// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { HttpDegradedConfig } from "../shared/schemas";
import { degradedReason } from "../worker/checks/evaluate";
import { api, ownerSession } from "./helpers";

const SECRET_URL = "https://internal-gallery.example/api/status/proxy";
const SECRET_ERROR = "connect ECONNREFUSED 10.20.30.40:8443";

type PublicStatus = {
  overall: string;
  liveAlerts: { down: string[]; degraded: string[] };
  groups: { name: string; items: { name: string; status: string }[] }[];
};

function httpConfig(degraded?: Record<string, unknown>) {
  return {
    url: SECRET_URL,
    method: "GET",
    expectedStatuses: [200],
    ...(degraded ? { degraded } : {}),
  };
}

function monitorBody(name: string, config: unknown, paused = true) {
  return JSON.stringify({
    name,
    type: "http",
    config,
    intervalSeconds: 60,
    timeoutSeconds: 10,
    retries: 1,
    recoveryThreshold: 1,
    channelIds: [],
    paused,
  });
}

/**
 * Created paused so no check runs, then unpaused in D1 only. The public
 * page reads the status stored in monitor_state, which the test sets.
 */
async function monitorWithStatus(
  owner: string,
  name: string,
  status: string,
): Promise<string> {
  const created = await api(
    "/api/monitors",
    {
      method: "POST",
      body: monitorBody(
        name,
        httpConfig({
          jsonPath: "$.status",
          jsonExpect: "degraded",
          maxResponseMs: 800,
        }),
      ),
    },
    owner,
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  await env.DB.prepare("UPDATE monitors SET paused = 0 WHERE id = ?")
    .bind(id)
    .run();
  await setStatus(id, status);
  return id;
}

async function setStatus(id: string, status: string) {
  await env.DB.prepare(
    "UPDATE monitor_state SET status = ?, last_error = ? WHERE monitor_id = ?",
  )
    .bind(status, status === "down" ? SECRET_ERROR : null, id)
    .run();
}

async function publish(
  owner: string,
  items: { monitorId: string; displayName?: string; groupName?: string }[],
): Promise<{ slug: string; id: string }> {
  const slug = `deg-${crypto.randomUUID().slice(0, 8)}`;
  const page = await api(
    "/api/status-pages",
    {
      method: "POST",
      body: JSON.stringify({
        slug,
        published: true,
        title: "Gallery status",
        description: "",
        items: items.map((item, position) => ({
          monitorId: item.monitorId,
          position,
          groupName: item.groupName ?? "Core",
          displayName: item.displayName ?? "",
        })),
      }),
    },
    owner,
  );
  expect(page.status, await page.clone().text()).toBe(201);
  return { slug, id: ((await page.json()) as { id: string }).id };
}

async function read(
  slug: string,
): Promise<{ body: PublicStatus; raw: string }> {
  const response = await api(`/api/public/status/${slug}`);
  expect(response.status).toBe(200);
  const raw = await response.text();
  return { body: JSON.parse(raw) as PublicStatus, raw };
}

describe("automatic live notices on the public page", () => {
  it("lists live down and degraded monitors by their page names", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const gallery = await monitorWithStatus(owner, `gal-${suffix}`, "degraded");
    const search = await monitorWithStatus(owner, `srch-${suffix}`, "down");
    const home = await monitorWithStatus(owner, `home-${suffix}`, "up");
    const plain = await monitorWithStatus(owner, `Plain ${suffix}`, "degraded");
    const page = await publish(owner, [
      { monitorId: gallery, displayName: "Gallery API" },
      { monitorId: search, displayName: "Search" },
      { monitorId: home, displayName: "Home" },
      { monitorId: plain },
    ]);
    const { body } = await read(page.slug);
    expect(body.liveAlerts).toEqual({
      down: ["Search"],
      degraded: ["Gallery API", `Plain ${suffix}`],
    });
    expect(body.groups[0]?.items.map((item) => item.status)).toEqual([
      "degraded",
      "down",
      "up",
      "degraded",
    ]);
  });

  it("does not let live down or degraded checks change the overall", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const down = await monitorWithStatus(owner, `d-${suffix}`, "down");
    const slow = await monitorWithStatus(owner, `s-${suffix}`, "degraded");
    const page = await publish(owner, [
      { monitorId: down },
      { monitorId: slow },
    ]);
    expect((await read(page.slug)).body.overall).toBe("operational");
    await setStatus(slow, "down");
    expect((await read(page.slug)).body.overall).toBe("operational");
  });

  it("shows only names: no target URL, error text, or condition", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const down = await monitorWithStatus(owner, `leak-d-${suffix}`, "down");
    const slow = await monitorWithStatus(owner, `leak-s-${suffix}`, "degraded");
    const page = await publish(owner, [
      { monitorId: down, displayName: "Proxy" },
      { monitorId: slow, displayName: "Images" },
    ]);
    const { body, raw } = await read(page.slug);
    expect(body.liveAlerts).toEqual({ down: ["Proxy"], degraded: ["Images"] });
    for (const hidden of [
      "internal-gallery.example",
      SECRET_ERROR,
      "10.20.30.40",
      "$.status",
      "maxResponseMs",
      `leak-d-${suffix}`,
      `leak-s-${suffix}`,
    ]) {
      expect(raw).not.toContain(hidden);
    }
  });

  it("clears each notice when the checks recover", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const down = await monitorWithStatus(owner, `c-d-${suffix}`, "down");
    const slow = await monitorWithStatus(owner, `c-s-${suffix}`, "degraded");
    const page = await publish(owner, [
      { monitorId: down, displayName: "Down one" },
      { monitorId: slow, displayName: "Slow one" },
    ]);
    expect((await read(page.slug)).body.liveAlerts).toEqual({
      down: ["Down one"],
      degraded: ["Slow one"],
    });
    await setStatus(down, "up");
    expect((await read(page.slug)).body.liveAlerts).toEqual({
      down: [],
      degraded: ["Slow one"],
    });
    await setStatus(slow, "up");
    expect((await read(page.slug)).body.liveAlerts).toEqual({
      down: [],
      degraded: [],
    });
  });

  it("leaves out monitors under an incident impact or maintenance", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const impacted = await monitorWithStatus(owner, `i-${suffix}`, "degraded");
    const maintained = await monitorWithStatus(owner, `m-${suffix}`, "down");
    const live = await monitorWithStatus(owner, `l-${suffix}`, "down");
    const page = await publish(owner, [
      { monitorId: impacted, displayName: "Impacted" },
      { monitorId: maintained, displayName: "Maintained" },
      { monitorId: live, displayName: "Live" },
    ]);
    const now = Date.now();
    const incident = await api(
      "/api/incidents",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Images ${suffix}`,
          notify: false,
          channelIds: [],
          pageIds: [page.id],
          monitors: [{ monitorId: impacted, impact: "partial_outage" }],
          update: { status: "investigating", body: "Looking", postedAt: now },
        }),
      },
      owner,
    );
    expect(incident.status, await incident.clone().text()).toBe(201);
    const window = await api(
      "/api/maintenance",
      {
        method: "POST",
        body: JSON.stringify({
          title: `Work ${suffix}`,
          description: "",
          timezone: "UTC",
          startAt: now - 60_000,
          endAt: now + 3_600_000,
          recurrence: "once",
          weekdays: [],
          notify: false,
          channelIds: [],
          pageIds: [page.id],
          monitorIds: [maintained],
        }),
      },
      owner,
    );
    expect(window.status, await window.clone().text()).toBe(201);
    const { body } = await read(page.slug);
    expect(body.liveAlerts).toEqual({ down: ["Live"], degraded: [] });
    expect(body.groups[0]?.items.map((item) => item.status)).toEqual([
      "partial_outage",
      "maintenance",
      "down",
    ]);
    // The incident still drives the overall; the live check does not.
    expect(body.overall).toBe("degraded");
  });

  it("leaves out paused, pending, and unknown monitors", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const paused = await monitorWithStatus(owner, `p-${suffix}`, "down");
    await env.DB.prepare("UPDATE monitors SET paused = 1 WHERE id = ?")
      .bind(paused)
      .run();
    const pending = await monitorWithStatus(owner, `q-${suffix}`, "pending");
    const unknown = await monitorWithStatus(owner, `u-${suffix}`, "unknown");
    const page = await publish(owner, [
      { monitorId: paused },
      { monitorId: pending },
      { monitorId: unknown },
    ]);
    const { body } = await read(page.slug);
    expect(body.liveAlerts).toEqual({ down: [], degraded: [] });
    expect(body.groups[0]?.items.map((item) => item.status)).toEqual([
      "paused",
      "pending",
      "unknown",
    ]);
  });

  it("names a monitor shown twice once, by its first page name", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const twice = await monitorWithStatus(owner, `t-${suffix}`, "degraded");
    const page = await publish(owner, [
      { monitorId: twice, displayName: "First name", groupName: "One" },
      { monitorId: twice, displayName: "Second name", groupName: "Two" },
    ]);
    expect((await read(page.slug)).body.liveAlerts).toEqual({
      down: [],
      degraded: ["First name"],
    });
  });

  it("returns empty notices for a page where every check is up", async () => {
    const owner = await ownerSession();
    const suffix = crypto.randomUUID().slice(0, 6);
    const up = await monitorWithStatus(owner, `ok-${suffix}`, "up");
    const page = await publish(owner, [{ monitorId: up }]);
    const { body } = await read(page.slug);
    expect(body.liveAlerts).toEqual({ down: [], degraded: [] });
    expect(body.overall).toBe("operational");
  });
});

describe("degraded condition validation on save", () => {
  async function create(owner: string, degraded: Record<string, unknown>) {
    return api(
      "/api/monitors",
      {
        method: "POST",
        body: monitorBody(
          `v-${crypto.randomUUID().slice(0, 8)}`,
          httpConfig(degraded),
        ),
      },
      owner,
    );
  }

  it.each([
    ["no $", "status"],
    ["a trailing dot", "$.status."],
    ["a wildcard", "$.items[*]"],
    ["a filter", "$[?(@.ok)]"],
    ["only spaces", "   "],
  ])("rejects a degraded JSON path with %s", async (_label, jsonPath) => {
    const owner = await ownerSession();
    const response = await create(owner, { jsonPath, jsonExpect: "degraded" });
    expect(response.status).toBe(400);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("validation");
  });

  it("saves a supported degraded JSON path as given", async () => {
    const owner = await ownerSession();
    const degraded = {
      keyword: "maintenance",
      keywordMode: "absent",
      jsonPath: "$.items[0]['state']",
      jsonExpect: "degraded",
      maxResponseMs: 1200,
      notify: false,
    };
    const response = await create(owner, degraded);
    expect(response.status, await response.clone().text()).toBe(201);
    const id = ((await response.json()) as { id: string }).id;
    const detail = await api(`/api/monitors/${id}`, {}, owner);
    const saved = (await detail.json()) as {
      config: { degraded: Record<string, unknown> };
    };
    expect(saved.config.degraded).toEqual(degraded);
  });

  it("accepts an empty degraded JSON path next to another condition", async () => {
    const owner = await ownerSession();
    const response = await create(owner, { jsonPath: "", keyword: "slow" });
    expect(response.status, await response.clone().text()).toBe(201);
  });

  it.each([
    ["a path without a value", { jsonPath: "$.status" }],
    ["a value without a path", { jsonExpect: "degraded" }],
    ["a zero limit", { maxResponseMs: 0 }],
    ["a limit over 30 seconds", { maxResponseMs: 30_001 }],
  ])("rejects %s", async (_label, degraded) => {
    const owner = await ownerSession();
    expect((await create(owner, degraded)).status).toBe(400);
  });

  async function savedDegraded(
    owner: string,
    id: string,
  ): Promise<HttpDegradedConfig> {
    const detail = (await (
      await api(`/api/monitors/${id}`, {}, owner)
    ).json()) as { config: { degraded?: HttpDegradedConfig } };
    if (!detail.config.degraded) throw new Error("no degraded block saved");
    return detail.config.degraded;
  }

  async function edit(
    owner: string,
    id: string,
    degraded: Record<string, unknown>,
  ) {
    return api(
      `/api/monitors/${id}`,
      { method: "PATCH", body: monitorBody("Edited", httpConfig(degraded)) },
      owner,
    );
  }

  async function monitorCount(): Promise<number> {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM monitors",
    ).first<{ n: number }>();
    return row?.n ?? 0;
  }

  it.each([
    ["two spaces", "  "],
    ["a tab and a newline", "\t\n"],
  ])("rejects a degraded keyword of %s on create", async (_label, keyword) => {
    const owner = await ownerSession();
    const before = await monitorCount();
    const response = await create(owner, { keyword, maxResponseMs: 500 });
    expect(response.status).toBe(400);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("validation");
    expect(await monitorCount()).toBe(before);
  });

  it.each([
    ["two spaces", "  "],
    ["a tab and a newline", "\t\n"],
  ])(
    "rejects a degraded keyword of %s on edit and keeps the saved one",
    async (_label, keyword) => {
      const owner = await ownerSession();
      const created = await create(owner, { keyword: "slow" });
      expect(created.status).toBe(201);
      const id = ((await created.json()) as { id: string }).id;
      const edited = await edit(owner, id, { keyword });
      expect(edited.status).toBe(400);
      expect(
        ((await edited.json()) as { error: { code: string } }).error.code,
      ).toBe("validation");
      expect((await savedDegraded(owner, id)).keyword).toBe("slow");
    },
  );

  it("saves an empty degraded keyword as no condition", async () => {
    const owner = await ownerSession();
    const response = await create(owner, { keyword: "" });
    expect(response.status, await response.clone().text()).toBe(201);
    const id = ((await response.json()) as { id: string }).id;
    const saved = await savedDegraded(owner, id);
    expect(saved.keyword).toBe("");
    for (const mode of ["present", "absent"] as const) {
      expect(
        degradedReason({ ...saved, keywordMode: mode }, "slow body", 1),
      ).toBeNull();
    }
  });

  it("saves and checks a degraded keyword with its spaces on create and edit", async () => {
    const owner = await ownerSession();
    const created = await create(owner, { keyword: "slow " });
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const saved = await savedDegraded(owner, id);
    expect(saved.keyword).toBe("slow ");
    expect(degradedReason(saved, "too slow now", 1)).toBe(
      "Degraded keyword was found",
    );
    expect(degradedReason(saved, "too slow.", 1)).toBeNull();

    const edited = await edit(owner, id, { keyword: " slow" });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const resaved = await savedDegraded(owner, id);
    expect(resaved.keyword).toBe(" slow");
    expect(degradedReason(resaved, "too slow", 1)).toBe(
      "Degraded keyword was found",
    );
    expect(degradedReason(resaved, "slow first", 1)).toBeNull();
  });

  it("rejects an invalid degraded path on edit and keeps the saved config", async () => {
    const owner = await ownerSession();
    const valid = { jsonPath: "$.status", jsonExpect: "degraded" };
    const created = await create(owner, valid);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const edited = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: monitorBody(
          "Edited",
          httpConfig({ jsonPath: "status", jsonExpect: "degraded" }),
        ),
      },
      owner,
    );
    expect(edited.status).toBe(400);
    const detail = (await (
      await api(`/api/monitors/${id}`, {}, owner)
    ).json()) as {
      config: { degraded: Record<string, unknown> };
    };
    expect(detail.config.degraded).toMatchObject(valid);
  });
});
