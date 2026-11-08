// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { api, ownerSession } from "../../test/helpers";
import { encryptString } from "../crypto/secret";
import { schedulerStub } from "../monitors/sync";
import { initialState, type RuntimeState } from "./state-machine";

const HOOK = "https://hooks.example/degraded";
const TARGET = "https://gallery.example/api/status/proxy";
const MINUTE = 60_000;

type Answer = "ok" | "degraded" | "down";
type Alert = { event: string; monitor: string; reason: string };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Stands in for the monitored service and the alert webhook. Checks get the
 * current answer. Webhook posts are recorded in order.
 */
function upstream(first: Answer = "ok") {
  const alerts: Alert[] = [];
  let answer: Answer = first;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(HOOK)) {
      alerts.push(JSON.parse(String(init?.body ?? "{}")) as Alert);
      return new Response("ok");
    }
    if (answer === "down") return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ status: answer }), { status: 200 });
  }) as typeof fetch;
  return {
    alerts,
    events: () => alerts.map((alert) => alert.event),
    answer(next: Answer) {
      answer = next;
    },
  };
}

function encryptionKey(): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not bound");
  return env.ENCRYPTION_KEY;
}

function httpConfig(degraded: Record<string, unknown> | null) {
  return {
    url: TARGET,
    method: "GET",
    headers: [],
    followRedirects: true,
    expectedStatuses: [200],
    keywordMode: "present",
    ...(degraded ? { degraded } : {}),
  };
}

const statusDegraded = {
  jsonPath: "$.status",
  jsonExpect: "degraded",
  keywordMode: "present",
  notify: true,
};

/** A monitor placed straight on its own shard, checked on a fake clock. */
async function shardMonitor(options: {
  degraded?: Record<string, unknown> | null;
  retries?: number;
  state?: RuntimeState;
}) {
  const id = crypto.randomUUID();
  const name = `Gallery ${id.slice(0, 8)}`;
  const shardId = `degraded-${id}`;
  const config = httpConfig(
    options.degraded === undefined ? statusDegraded : options.degraded,
  );
  const retries = options.retries ?? 0;
  const created = Date.now();
  await env.DB.prepare(
    `INSERT INTO monitors (
      id, organization_id, name, type, config_json, interval_seconds,
      timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
      paused, created_at, updated_at
    ) VALUES (?, 'org-degraded', ?, 'http', ?, 60, 10, ?, 1, '["default"]', ?, 0, ?, ?)`,
  )
    .bind(id, name, JSON.stringify(config), retries, shardId, created, created)
    .run();
  const channelId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO notification_channels (
      id, organization_id, name, type, config_encrypted, created_at, updated_at
    ) VALUES (?, 'org-degraded', ?, 'webhook', ?, ?, ?)`,
  )
    .bind(
      channelId,
      `Hook ${id.slice(0, 8)}`,
      await encryptString(encryptionKey(), JSON.stringify({ url: HOOK })),
      created,
      created,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO monitor_channels (monitor_id, channel_id) VALUES (?, ?)",
  )
    .bind(id, channelId)
    .run();
  // An hour ahead so the shard alarm never runs a check on its own.
  let clock = created + 3_600_000;
  const stub = schedulerStub(env, shardId);
  const snapshot = (
    nextConfig: unknown,
    state: RuntimeState,
    nextCheckAt: number,
  ) => ({
    id,
    name,
    type: "http" as const,
    intervalMs: MINUTE,
    timeoutMs: 10_000,
    retries,
    recoveryThreshold: 1,
    config: nextConfig,
    paused: false,
    nextCheckAt,
    state,
    lastPushAt: null,
    regions: ["default"],
  });
  await stub.upsert(
    snapshot(
      config,
      options.state ?? {
        ...initialState(created),
        status: "up",
        consecutiveSuccesses: 1,
      },
      clock,
    ),
  );
  return {
    id,
    name,
    stub,
    get clock() {
      return clock;
    },
    async check(): Promise<RuntimeState | undefined> {
      const due = (await stub.scheduleOf(id))?.nextCheckAt ?? clock;
      clock = Math.max(clock, due);
      await stub.runDue(clock);
      clock += MINUTE;
      return (await stub.getOne(id))?.state;
    },
    /** The edit path with a live shard copy: same state, new config. */
    async reconfigure(degraded: Record<string, unknown> | null) {
      const live = await stub.getOne(id);
      if (!live) throw new Error("monitor left the shard");
      await stub.upsert(
        snapshot(httpConfig(degraded), live.state, live.nextCheckAt),
      );
    },
  };
}

async function storedFlag(id: string) {
  return env.DB.prepare(
    "SELECT status, degraded_notified FROM monitor_state WHERE monitor_id = ?",
  )
    .bind(id)
    .first<{ status: string; degraded_notified: number }>();
}

describe("degraded alerts on the shard", () => {
  it("sends one entry and one clear across a degraded episode", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    expect((await monitor.check())?.status).toBe("degraded");
    await monitor.check();
    await monitor.check();
    service.answer("ok");
    expect((await monitor.check())?.status).toBe("up");
    await monitor.check();
    expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    expect(service.alerts[0]).toMatchObject({
      event: "degraded",
      monitor: monitor.name,
      reason: "Degraded JSON value matched",
    });
    expect(service.alerts[1]?.monitor).toBe(monitor.name);
  });

  it("sends neither alert when degraded alerts are off", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({
      degraded: { ...statusDegraded, notify: false },
    });
    expect((await monitor.check())?.status).toBe("degraded");
    service.answer("ok");
    expect((await monitor.check())?.status).toBe("up");
    expect(service.events()).toEqual([]);
  });

  it("stores the up and degraded swap in D1 even with alerts off", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({
      degraded: { ...statusDegraded, notify: false },
    });
    await monitor.check();
    expect(await storedFlag(monitor.id)).toEqual({
      status: "degraded",
      degraded_notified: 0,
    });
    service.answer("ok");
    await monitor.check();
    expect((await storedFlag(monitor.id))?.status).toBe("up");
  });

  it("sends the clear after the conditions are removed", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    await monitor.check();
    await monitor.reconfigure(null);
    expect((await monitor.check())?.status).toBe("up");
    expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
  });

  it("sends the clear after alerts were turned off while degraded", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    await monitor.check();
    await monitor.reconfigure({ ...statusDegraded, notify: false });
    expect((await monitor.check())?.status).toBe("degraded");
    service.answer("ok");
    await monitor.check();
    expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
  });

  it("sends down then up, not a clear, when a degraded monitor goes down", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    await monitor.check();
    service.answer("down");
    expect((await monitor.check())?.status).toBe("down");
    service.answer("ok");
    expect((await monitor.check())?.status).toBe("up");
    expect(service.events()).toEqual(["degraded", "down", "up"]);
  });

  it("sends recovery and then the degraded entry when down recovers into degraded", async () => {
    const service = upstream("down");
    const monitor = await shardMonitor({});
    expect((await monitor.check())?.status).toBe("down");
    service.answer("degraded");
    expect((await monitor.check())?.status).toBe("degraded");
    expect(service.events()).toEqual(["down", "up", "degraded"]);
  });

  it("does not repeat the entry after a failed retry in between", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({ retries: 2 });
    await monitor.check();
    service.answer("down");
    expect((await monitor.check())?.status).toBe("pending");
    service.answer("degraded");
    expect((await monitor.check())?.status).toBe("degraded");
    service.answer("ok");
    await monitor.check();
    expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
  });

  it("does not alert for a monitor without degraded conditions", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({ degraded: null });
    expect((await monitor.check())?.status).toBe("up");
    expect(service.events()).toEqual([]);
  });
});

describe("degraded alerts while flapping on the shard", () => {
  /**
   * One check a minute from minute 0 through `until`. The service switches
   * answers at the given minutes. Returns the webhook events with their
   * minute and the stored flag after each check.
   */
  async function minutes(
    changes: Record<number, Answer>,
    until: number,
  ): Promise<{
    id: string;
    sent: [number, string][];
    flags: Map<number, boolean>;
  }> {
    const service = upstream("ok");
    const monitor = await shardMonitor({});
    const sent: [number, string][] = [];
    const flags = new Map<number, boolean>();
    for (let minute = 0; minute <= until; minute += 1) {
      const change = changes[minute];
      if (change) service.answer(change);
      const before = service.alerts.length;
      const state = await monitor.check();
      flags.set(minute, state?.degradedNotified === true);
      for (const alert of service.alerts.slice(before))
        sent.push([minute, alert.event]);
    }
    return { id: monitor.id, sent, flags };
  }

  // Down at 0, degraded at 5, down at 10 (unstable), degraded at 15.
  const flapping: Record<number, Answer> = {
    0: "down",
    5: "degraded",
    10: "down",
    15: "degraded",
  };
  const beforePause = [
    [0, "down"],
    [5, "up"],
    [5, "degraded"],
    [10, "unstable"],
  ];

  it("sends no entry, down, up, or clear while two flips stay in the window", async () => {
    const run = await minutes({ ...flapping, 37: "down", 39: "ok" }, 39);
    expect(run.sent).toEqual(beforePause);
    for (let minute = 10; minute <= 39; minute += 1)
      expect(run.flags.get(minute), `minute ${minute}`).toBe(false);
    expect(await storedFlag(run.id)).toEqual({
      status: "up",
      degraded_notified: 0,
    });
  });

  it("sends the entry once at the first check with one flip left, then the clear", async () => {
    const run = await minutes(
      { ...flapping, 37: "down", 38: "degraded", 70: "ok" },
      70,
    );
    expect(run.sent).toEqual([
      ...beforePause,
      [68, "degraded"],
      [70, "degraded_resolved"],
    ]);
    expect(run.flags.get(67)).toBe(false);
    expect(run.flags.get(68)).toBe(true);
  });
});

describe("degraded alerts during maintenance", () => {
  async function maintain(monitorId: string, from: number, until: number) {
    const windowId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO maintenance_windows (
        id, organization_id, title, description, timezone, start_at, end_at,
        recurrence, weekdays_json, notify, created_at, updated_at
      ) VALUES (?, 'org-degraded', 'Window', '', 'UTC', ?, ?, 'once', '[]', 0, ?, ?)`,
    )
      .bind(windowId, from, until, Date.now(), Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)",
    )
      .bind(windowId, monitorId)
      .run();
  }

  it("enters degraded inside a window without an alert and keeps the flag", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    await maintain(monitor.id, monitor.clock - MINUTE, monitor.clock + 30_000);
    expect((await monitor.check())?.status).toBe("degraded");
    expect(service.events()).toEqual([]);
    expect(await storedFlag(monitor.id)).toEqual({
      status: "degraded",
      degraded_notified: 1,
    });
    // After the window the monitor is still degraded: no late entry.
    await monitor.check();
    await monitor.check();
    expect(service.events()).toEqual([]);
    // The clear is sent on its own (decision 57).
    service.answer("ok");
    await monitor.check();
    expect(service.events()).toEqual(["degraded_resolved"]);
  });

  it("clears inside a window without an alert and drops the flag", async () => {
    const service = upstream("degraded");
    const monitor = await shardMonitor({});
    await monitor.check();
    expect(service.events()).toEqual(["degraded"]);
    await maintain(monitor.id, monitor.clock - 1, monitor.clock + 30_000);
    service.answer("ok");
    const state = await monitor.check();
    expect(state?.status).toBe("up");
    expect(state?.degradedNotified).toBe(false);
    service.answer("degraded");
    await monitor.check();
    expect(service.events()).toEqual(["degraded", "degraded"]);
  });
});

describe("degraded alerts through the API", () => {
  async function webhookChannel(owner: string): Promise<string> {
    const created = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Hook ${crypto.randomUUID().slice(0, 8)}`,
          type: "webhook",
          config: { url: HOOK },
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  function body(
    name: string,
    channelId: string,
    degraded: Record<string, unknown> | null,
  ) {
    return JSON.stringify({
      name,
      type: "http",
      config: httpConfig(degraded),
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 1,
      recoveryThreshold: 1,
      channelIds: [channelId],
    });
  }

  async function apiMonitor(
    owner: string,
    degraded: Record<string, unknown> | null,
  ) {
    const channelId = await webhookChannel(owner);
    const name = `Api gallery ${crypto.randomUUID().slice(0, 8)}`;
    const created = await api(
      "/api/monitors",
      { method: "POST", body: body(name, channelId, degraded) },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const row = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    if (!row) throw new Error("monitor missing");
    const stub = schedulerStub(env, row.shard_id);
    let clock = Date.now() + 3_600_000;
    return {
      id,
      name,
      stub,
      async check() {
        await stub.runDue(clock);
        clock += MINUTE;
        return (await stub.getOne(id))?.state;
      },
      async edit(next: Record<string, unknown> | null) {
        const response = await api(
          `/api/monitors/${id}`,
          { method: "PATCH", body: body(name, channelId, next) },
          owner,
        );
        expect(response.status, await response.clone().text()).toBe(200);
      },
      async pause(paused: boolean) {
        const response = await api(
          `/api/monitors/${id}`,
          { method: "PATCH", body: JSON.stringify({ paused }) },
          owner,
        );
        expect(response.status, await response.clone().text()).toBe(200);
      },
      /** Drops the shard copy without saving, so the next read is D1. */
      async forgetOnShard() {
        await stub.remove(id);
        expect(await stub.getOne(id)).toBeNull();
      },
      async cleanup() {
        await api(`/api/monitors/${id}`, { method: "DELETE" }, owner);
      },
    };
  }

  it("does not alert on the first check run by create", async () => {
    const owner = await ownerSession();
    const service = upstream("degraded");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      expect((await monitor.stub.getOne(monitor.id))?.state.status).toBe(
        "degraded",
      );
      expect(service.events()).toEqual([]);
      expect(await storedFlag(monitor.id)).toEqual({
        status: "degraded",
        degraded_notified: 1,
      });
      await monitor.check();
      expect(service.events()).toEqual([]);
      // Decision 57: the flag is set without the entry, so the clear can
      // arrive on its own.
      service.answer("ok");
      await monitor.check();
      expect(service.events()).toEqual(["degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends the clear after conditions are removed, with the state reloaded from D1", async () => {
    const owner = await ownerSession();
    const service = upstream("ok");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      service.answer("degraded");
      await monitor.check();
      expect(service.events()).toEqual(["degraded"]);
      expect(await storedFlag(monitor.id)).toEqual({
        status: "degraded",
        degraded_notified: 1,
      });
      await monitor.forgetOnShard();
      service.answer("ok");
      await monitor.edit(null);
      await monitor.check();
      expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends the clear after alerts are turned off, with the state reloaded from D1", async () => {
    const owner = await ownerSession();
    const service = upstream("ok");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      service.answer("degraded");
      await monitor.check();
      await monitor.forgetOnShard();
      await monitor.edit({ ...statusDegraded, notify: false });
      await monitor.check();
      expect(service.events()).toEqual(["degraded"]);
      service.answer("ok");
      await monitor.check();
      expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("starts with the entry when alerts are turned on while degraded and D1 is reloaded", async () => {
    const owner = await ownerSession();
    const service = upstream("degraded");
    const monitor = await apiMonitor(owner, {
      ...statusDegraded,
      notify: false,
    });
    try {
      await monitor.check();
      expect(service.events()).toEqual([]);
      expect(await storedFlag(monitor.id)).toEqual({
        status: "degraded",
        degraded_notified: 0,
      });
      await monitor.forgetOnShard();
      await monitor.edit(statusDegraded);
      await monitor.check();
      expect(service.events()).toEqual(["degraded"]);
      service.answer("ok");
      await monitor.check();
      expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends no clear on its own when alerts were off for the whole episode", async () => {
    const owner = await ownerSession();
    const service = upstream("degraded");
    const monitor = await apiMonitor(owner, {
      ...statusDegraded,
      notify: false,
    });
    try {
      await monitor.check();
      await monitor.forgetOnShard();
      service.answer("ok");
      await monitor.edit(statusDegraded);
      await monitor.check();
      expect(service.events()).toEqual([]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends the entry once across pause and resume", async () => {
    const owner = await ownerSession();
    const service = upstream("ok");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      service.answer("degraded");
      await monitor.check();
      await monitor.pause(true);
      expect(await storedFlag(monitor.id)).toEqual({
        status: "paused",
        degraded_notified: 1,
      });
      await monitor.pause(false);
      await monitor.check();
      await monitor.check();
      expect(service.events()).toEqual(["degraded"]);
      service.answer("ok");
      await monitor.check();
      expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends the entry once across resume when the shard lost the monitor", async () => {
    const owner = await ownerSession();
    const service = upstream("ok");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      service.answer("degraded");
      await monitor.check();
      await monitor.pause(true);
      await monitor.forgetOnShard();
      await monitor.pause(false);
      expect(
        (await monitor.stub.getOne(monitor.id))?.state.degradedNotified,
      ).toBe(true);
      await monitor.check();
      expect(service.events()).toEqual(["degraded"]);
      service.answer("ok");
      await monitor.check();
      expect(service.events()).toEqual(["degraded", "degraded_resolved"]);
    } finally {
      await monitor.cleanup();
    }
  });

  it("sends the entry on the first degraded check after a D1 reload while flapping", async () => {
    const owner = await ownerSession();
    const service = upstream("ok");
    const monitor = await apiMonitor(owner, statusDegraded);
    try {
      for (const answer of ["down", "degraded", "down", "degraded"] as const) {
        service.answer(answer);
        await monitor.check();
      }
      // Paused after the unstable notice: the last recovery sent nothing.
      expect(service.events()).toEqual(["down", "up", "degraded", "unstable"]);
      const stored = await env.DB.prepare(
        "SELECT status, flapping, degraded_notified FROM monitor_state WHERE monitor_id = ?",
      )
        .bind(monitor.id)
        .first<{
          status: string;
          flapping: number;
          degraded_notified: number;
        }>();
      expect(stored).toEqual({
        status: "degraded",
        flapping: 1,
        degraded_notified: 0,
      });
      // D1 keeps the flapping flag but not the flip times, so the reloaded
      // state has no flips in the window and the entry goes out.
      await monitor.forgetOnShard();
      await monitor.edit(statusDegraded);
      await monitor.check();
      expect(service.events()).toEqual([
        "down",
        "up",
        "degraded",
        "unstable",
        "degraded",
      ]);
      service.answer("ok");
      await monitor.check();
      expect(service.events().at(-1)).toBe("degraded_resolved");
      expect(service.events()).toHaveLength(6);
    } finally {
      await monitor.cleanup();
    }
  });
});
