// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECK_REGION_KEY,
  effectiveRegion,
  regionOfShard,
  storedRegion,
} from "../../shared/regions";
import { readCheckRegion } from "../check-region";
import { getDb } from "../db/client";
import { monitors } from "../db/schema";
import { schedulerStub } from "../monitors/sync";
import { writeSetting } from "../settings-store";
import {
  FREE_CRON_STATEMENT_BUDGET,
  openCronBudget,
  withDatabase,
} from "./budget";
import {
  needsMove,
  PLACEMENT_BATCH,
  PLACEMENT_MOVE_STATEMENTS,
  PLACEMENT_SCAN_STATEMENTS,
  relocateMonitor,
  settlePlacement,
} from "./placement";
import { initialState } from "./state-machine";

const created: string[] = [];

afterEach(async () => {
  await writeSetting(env, CHECK_REGION_KEY, "auto");
  for (const id of created.splice(0)) {
    const row = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    if (row)
      await schedulerStub(env, row.shard_id)
        .remove(id)
        .catch(() => undefined);
    await env.DB.prepare("DELETE FROM outages WHERE monitor_id = ?")
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM monitor_state WHERE monitor_id = ?")
      .bind(id)
      .run();
    await env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id).run();
  }
  let guard = 0;
  let remaining = 1;
  while (remaining > 0 && guard < 30) {
    const placed = await settlePlacement(env, PLACEMENT_BATCH);
    remaining = placed.remaining;
    guard += 1;
    if (placed.moved === 0) break;
  }
});

async function insertMonitor(
  id: string,
  shardId: string,
  regionsJson = '["default"]',
) {
  created.push(id);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO monitors (
      id, organization_id, name, type, config_json, interval_seconds,
      timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
      paused, created_at, updated_at
    ) VALUES (?, 'org-region', ?, 'heartbeat', '{"graceSeconds":30}', 60, 10, 2, 1, ?, ?, 0, ?, ?)`,
  )
    .bind(id, id, regionsJson, shardId, now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO monitor_state (
      monitor_id, status, since, last_response_ms, last_check_at,
      consecutive_failures, consecutive_successes, last_error, flapping
    ) VALUES (?, 'down', ?, 40, ?, 3, 0, 'down', 0)`,
  )
    .bind(id, now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO outages (id, monitor_id, started_at, ended_at, cause)
     VALUES (?, ?, ?, NULL, 'down')`,
  )
    .bind(crypto.randomUUID(), id, now)
    .run();
}

async function seedShard(id: string, shardId: string) {
  const now = Date.now();
  const stub = schedulerStub(env, shardId);
  await stub.upsert({
    id,
    name: id,
    type: "heartbeat",
    intervalMs: 60_000,
    timeoutMs: 10_000,
    retries: 2,
    recoveryThreshold: 1,
    config: { graceSeconds: 30 },
    paused: false,
    nextCheckAt: now + 60_000,
    state: {
      ...initialState(now),
      status: "down",
      consecutiveFailures: 3,
      lastResponseMs: 40,
      lastError: "down",
    },
    lastPushAt: null,
    regions: ["auto"],
  });
  await stub.noteSample(id, { t: now, ok: false, ms: 40, internal: false });
  return stub;
}

describe("region placement", () => {
  it("moves a monitor once, keeps persisted state, and stops an empty shard", async () => {
    const id = crypto.randomUUID();
    const source = `oc-${800_000 + Math.floor(Math.random() * 100_000)}`;
    await insertMonitor(id, source, '["apac"]');
    const before = await seedShard(id, source);
    expect((await before.getOne(id))?.recent.length).toBeGreaterThan(0);
    expect(await before.alarmAt()).not.toBeNull();

    const row = await getDb(env.DB)
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!row) throw new Error("missing monitor");
    const destination = await relocateMonitor(env, row, "auto");
    expect(regionOfShard(destination)).toBe("apac");
    expect(destination).not.toBe(source);

    const again = await getDb(env.DB)
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!again) throw new Error("missing monitor");
    expect(await relocateMonitor(env, again, "auto")).toBe(destination);

    expect(await before.getOne(id)).toBeNull();
    expect(await before.alarmAt()).toBeNull();
    const landed = await schedulerStub(env, destination).getOne(id);
    expect(landed?.state.status).toBe("down");
    expect(landed?.state.consecutiveFailures).toBe(3);
    expect(landed?.recent ?? []).toEqual([]);
    const copies = [
      ...(await before.getAll()),
      ...(await schedulerStub(env, destination).getAll()),
    ].filter((item) => item.id === id);
    expect(copies).toHaveLength(1);
    const outage = await env.DB.prepare(
      "SELECT ended_at FROM outages WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{ ended_at: number | null }>();
    expect(outage?.ended_at).toBeNull();
    const state = await env.DB.prepare(
      "SELECT consecutive_failures, status FROM monitor_state WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{ consecutive_failures: number; status: string }>();
    expect(state).toMatchObject({ consecutive_failures: 3, status: "down" });
  });

  it("resolves inherit, override, and explicit automatic without a second copy", async () => {
    // relocateMonitor takes the resolved global region. Writing the setting
    // and then calling settle would move every inherited monitor in the
    // shared test database, so this case reads the setting and moves only
    // the rows it created.
    await writeSetting(env, CHECK_REGION_KEY, "apac");
    const globalRegion = await readCheckRegion(env);
    expect(globalRegion).toBe("apac");
    const inherited = crypto.randomUUID();
    const override = crypto.randomUUID();
    const automatic = crypto.randomUUID();
    const inheritedShard = `weur-${810_000 + Math.floor(Math.random() * 10_000)}`;
    const overrideShard = `weur-${820_000 + Math.floor(Math.random() * 10_000)}`;
    const automaticShard = `sam-${830_000 + Math.floor(Math.random() * 10_000)}`;
    await insertMonitor(inherited, inheritedShard, '["default"]');
    await insertMonitor(override, overrideShard, '["weur"]');
    await insertMonitor(automatic, automaticShard, '["auto"]');
    await seedShard(inherited, inheritedShard);
    await seedShard(override, overrideShard);
    await seedShard(automatic, automaticShard);

    for (const id of [inherited, override, automatic]) {
      const row = await getDb(env.DB)
        .select()
        .from(monitors)
        .where(eq(monitors.id, id))
        .get();
      if (!row) throw new Error("missing monitor");
      expect(needsMove(row, globalRegion)).toBe(
        regionOfShard(row.shardId) !==
          effectiveRegion(storedRegion(row.regionsJson), globalRegion),
      );
      await relocateMonitor(env, row, globalRegion);
    }
    await writeSetting(env, CHECK_REGION_KEY, "auto");

    const rows = await env.DB.prepare(
      "SELECT id, shard_id, regions_json FROM monitors WHERE id IN (?, ?, ?)",
    )
      .bind(inherited, override, automatic)
      .all<{ id: string; shard_id: string; regions_json: string }>();
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    const inheritedRow = byId.get(inherited);
    const overrideRow = byId.get(override);
    const automaticRow = byId.get(automatic);
    expect(regionOfShard(inheritedRow?.shard_id ?? "")).toBe(
      effectiveRegion(storedRegion(inheritedRow?.regions_json ?? ""), "apac"),
    );
    expect(regionOfShard(overrideRow?.shard_id ?? "")).toBe("weur");
    expect(overrideRow?.shard_id).toBe(overrideShard);
    expect(regionOfShard(automaticRow?.shard_id ?? "")).toBe("auto");

    for (const [id, shard] of [
      [inherited, inheritedRow?.shard_id],
      [override, overrideShard],
      [automatic, automaticRow?.shard_id],
    ] as const) {
      if (!shard) throw new Error("missing shard");
      const present = (await schedulerStub(env, shard).getAll()).filter(
        (item) => item.id === id,
      );
      expect(present).toHaveLength(1);
    }
    expect(
      await schedulerStub(env, inheritedShard).getOne(inherited),
    ).toBeNull();
    expect(await schedulerStub(env, inheritedShard).alarmAt()).toBeNull();
    expect(await schedulerStub(env, automaticShard).alarmAt()).toBeNull();
  });

  it("retries a move that stopped after the monitor left the old shard", async () => {
    const id = crypto.randomUUID();
    const source = `afr-${840_000 + Math.floor(Math.random() * 10_000)}`;
    await insertMonitor(id, source, '["me"]');
    const stub = await seedShard(id, source);
    expect(await stub.detach(id)).not.toBeNull();
    expect(await stub.getOne(id)).toBeNull();
    expect(await stub.alarmAt()).toBeNull();
    const still = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    expect(still?.shard_id).toBe(source);

    let row: { shard_id: string } | null = null;
    for (let step = 0; step < 40; step += 1) {
      row = await env.DB.prepare("SELECT shard_id FROM monitors WHERE id = ?")
        .bind(id)
        .first<{ shard_id: string }>();
      if (regionOfShard(row?.shard_id ?? "") === "me") break;
      await settlePlacement(env, PLACEMENT_BATCH);
    }
    expect(regionOfShard(row?.shard_id ?? "")).toBe("me");
    expect(await stub.getOne(id)).toBeNull();
    const destination = row?.shard_id ?? "";
    expect(await schedulerStub(env, destination).getOne(id)).not.toBeNull();
    await settlePlacement(env, PLACEMENT_BATCH);
    const after = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    expect(after?.shard_id).toBe(destination);
    expect(
      (await schedulerStub(env, destination).getAll()).filter(
        (item) => item.id === id,
      ),
    ).toHaveLength(1);
  });

  it("keeps placement inside the cron statement budget", async () => {
    expect(
      PLACEMENT_SCAN_STATEMENTS + PLACEMENT_BATCH * PLACEMENT_MOVE_STATEMENTS,
    ).toBeLessThanOrEqual(FREE_CRON_STATEMENT_BUDGET);

    const id = crypto.randomUUID();
    const source = `oc-${850_000 + Math.floor(Math.random() * 10_000)}`;
    await insertMonitor(id, source, '["apac-ne"]');
    await seedShard(id, source);
    const tight = openCronBudget(env.DB, PLACEMENT_SCAN_STATEMENTS);
    const deferred = await settlePlacement(
      withDatabase(env, tight.database),
      PLACEMENT_BATCH,
    );
    expect(deferred.deferred).toBe(true);
    expect(deferred.moved).toBe(0);
    expect(tight.used()).toBeLessThanOrEqual(PLACEMENT_SCAN_STATEMENTS);
    const still = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    expect(still?.shard_id).toBe(source);

    const budget = openCronBudget(env.DB, FREE_CRON_STATEMENT_BUDGET);
    const placed = await settlePlacement(withDatabase(env, budget.database));
    expect(budget.used()).toBeLessThanOrEqual(FREE_CRON_STATEMENT_BUDGET);
    expect(budget.used()).toBeLessThanOrEqual(
      PLACEMENT_SCAN_STATEMENTS + PLACEMENT_BATCH * PLACEMENT_MOVE_STATEMENTS,
    );
    expect(placed.moved).toBeLessThanOrEqual(PLACEMENT_BATCH);
    expect(placed.moved).toBeGreaterThan(0);
  });
});
