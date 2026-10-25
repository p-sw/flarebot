// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { schedulerStub } from "../worker/monitors/sync";
import { api, ownerSession } from "./helpers";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function requests(urls: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    urls.push(url);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
}

describe("monitor update", () => {
  it("validates the write schema and reschedules the shard for a new target or interval", async () => {
    const owner = await ownerSession();
    const seen: string[] = [];
    requests(seen);
    const created = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Web",
          type: "http",
          config: {
            url: "https://example.com/old",
            method: "GET",
            followRedirects: true,
            expectedStatuses: [200],
          },
          intervalSeconds: 3600,
          timeoutSeconds: 10,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const row = await env.DB.prepare(
      "SELECT shard_id, created_at FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string; created_at: number }>();
    if (!row) throw new Error("monitor missing");
    const stub = schedulerStub(env, row.shard_id);
    const seededAt = Date.now() + 3_600_000;
    const current = await stub.getOne(id);
    if (!current) throw new Error("scheduler missing monitor");
    await stub.upsert({
      id,
      name: "Web",
      type: "http",
      intervalMs: 3_600_000,
      timeoutMs: 10_000,
      retries: 1,
      recoveryThreshold: 1,
      config: {
        url: "https://example.com/old",
        method: "GET",
        followRedirects: true,
        expectedStatuses: [200],
      },
      paused: false,
      nextCheckAt: seededAt,
      state: current.state,
      lastPushAt: null,
      regions: ["default"],
    });

    const invalid = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Web",
          type: "http",
          config: { url: "https://example.com/old" },
          intervalSeconds: 10,
        }),
      },
      owner,
    );
    expect(invalid.status).toBe(400);
    const blocked = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Web",
          type: "http",
          config: { url: "http://127.0.0.1/secret" },
          intervalSeconds: 3600,
          timeoutSeconds: 10,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      },
      owner,
    );
    expect(blocked.status).toBe(400);
    const unknownChannel = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Web",
          type: "http",
          config: { url: "https://example.com/old" },
          intervalSeconds: 3600,
          timeoutSeconds: 10,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: ["00000000-0000-4000-8000-000000000000"],
        }),
      },
      owner,
    );
    expect(unknownChannel.status).toBe(400);
    const untouched = await stub.scheduleOf(id);
    expect(untouched?.intervalMs).toBe(3_600_000);
    expect(untouched?.nextCheckAt).toBe(seededAt);
    expect(untouched?.config).toMatchObject({
      url: "https://example.com/old",
    });

    const intervalOnly = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Web",
          type: "http",
          config: {
            url: "https://example.com/old",
            method: "GET",
            followRedirects: true,
            expectedStatuses: [200],
          },
          intervalSeconds: 120,
          timeoutSeconds: 15,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      },
      owner,
    );
    expect(intervalOnly.status, await intervalOnly.clone().text()).toBe(200);
    const pulled = await stub.scheduleOf(id);
    expect(pulled?.intervalMs).toBe(120_000);
    expect(pulled?.timeoutMs).toBe(15_000);
    expect(pulled?.config).toMatchObject({ url: "https://example.com/old" });
    expect(pulled?.nextCheckAt).toBeLessThanOrEqual(Date.now() + 120_000);
    expect(pulled?.nextCheckAt).toBeGreaterThan(Date.now() + 60_000);
    expect((await stub.runDue(Date.now() + 1_000)).ran).toBe(0);

    seen.length = 0;
    const renamed = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Renamed",
          type: "http",
          config: {
            url: "https://example.com/old",
            method: "GET",
            followRedirects: true,
            expectedStatuses: [200],
          },
          intervalSeconds: 120,
          timeoutSeconds: 15,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      },
      owner,
    );
    expect(renamed.status).toBe(200);
    const kept = await stub.scheduleOf(id);
    expect(kept?.nextCheckAt).toBe(pulled?.nextCheckAt);
    expect(kept?.config).toMatchObject({ url: "https://example.com/old" });

    const moved = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Renamed",
          type: "http",
          config: {
            url: "https://example.com/new",
            method: "POST",
            headers: [{ name: "Authorization", value: "Bearer secret" }],
            followRedirects: false,
            expectedStatuses: [201],
            keyword: "ready",
          },
          intervalSeconds: 120,
          timeoutSeconds: 15,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      },
      owner,
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    const saved = (await moved.json()) as {
      config: { url: string; method: string; headers: { name: string }[] };
      intervalSeconds: number;
      createdAt: number;
      updatedAt: number;
      target: string;
      statusPages: { title: string }[];
    };
    expect(saved.config.url).toBe("https://example.com/new");
    expect(saved.config.method).toBe("POST");
    expect(saved.config.headers[0]?.name).toBe("Authorization");
    expect(saved.intervalSeconds).toBe(120);
    expect(saved.target).toBe("https://example.com/new");
    expect(saved.createdAt).toBe(row.created_at);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
    const due = await stub.scheduleOf(id);
    expect(due?.config).toMatchObject({ url: "https://example.com/new" });
    expect(due?.intervalMs).toBe(120_000);
    if ((due?.nextCheckAt ?? 0) <= Date.now() + 2_000) {
      expect((await stub.runDue(Date.now() + 5_000)).ran).toBe(1);
    }
    expect(seen.some((url) => url.includes("/new"))).toBe(true);
    expect(seen.some((url) => url.includes("/old"))).toBe(false);
    const following = await stub.scheduleOf(id);
    const delay = (following?.nextCheckAt ?? 0) - Date.now();
    expect(delay).toBeGreaterThan(90_000);
    expect(delay).toBeLessThanOrEqual(130_000);

    const page = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: `web-${id.slice(0, 8)}`,
          published: true,
          title: "Public web",
          description: "",
          items: [
            {
              monitorId: id,
              position: 0,
              groupName: "Edge",
              displayName: "Edge API",
            },
          ],
        }),
      },
      owner,
    );
    expect(page.status, await page.clone().text()).toBe(201);
    const detail = await api(`/api/monitors/${id}`, {}, owner);
    const body = (await detail.json()) as {
      statusPages: { title: string; slug: string }[];
      updatedAt: number;
    };
    expect(body.statusPages).toEqual([
      expect.objectContaining({
        title: "Public web",
        slug: `web-${id.slice(0, 8)}`,
      }),
    ]);
  });
});
