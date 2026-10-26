// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  firstRetainedDay,
  HISTORY_PRUNE_STATE_KEY,
  HISTORY_RETENTION_KEY,
  HOUR_MS,
  PRUNE_BATCH,
  PRUNE_CATCHUP_INTERVAL_MS,
  PRUNE_DAILY_CAP,
  retentionCutoff,
  SLOT_MS,
  utcDayStart,
} from "../shared/history";
import { pruneHistory } from "../worker/retention";
import { writeSetting } from "../worker/settings-store";
import { api, ownerSession } from "./helpers";

async function insertMonitor(id: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO monitors (
      id, organization_id, name, type, config_json, interval_seconds,
      timeout_seconds, retries, recovery_threshold, regions_json, shard_id,
      paused, created_at, updated_at
    ) VALUES (?, ?, 'Retention', 'heartbeat', '{}', 60, 10, 2, 1, '["default"]', 'retention', 0, ?, ?)`,
  )
    .bind(id, crypto.randomUUID(), now, now)
    .run();
}

async function resetPruneClock(): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?")
    .bind(HISTORY_PRUNE_STATE_KEY)
    .run();
}

async function countRows(
  table: "uptime_hourly" | "uptime_daily" | "outages",
  monitorId: string,
): Promise<number> {
  const column = table === "outages" ? "monitor_id" : "monitor_id";
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(monitorId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("history retention", () => {
  it("stores the retention period and rejects values outside 1 to 3650 days", async () => {
    const owner = await ownerSession();
    const initial = await api("/api/settings", {}, owner);
    expect(initial.status).toBe(200);
    const before = (await initial.json()) as { historyRetentionDays: number };
    expect(before.historyRetentionDays).toBeGreaterThan(0);

    const saved = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ historyRetentionDays: 14 }) },
      owner,
    );
    expect(saved.status).toBe(200);
    const after = (await (await api("/api/settings", {}, owner)).json()) as {
      historyRetentionDays: number;
    };
    expect(after.historyRetentionDays).toBe(14);

    expect(
      (
        await api(
          "/api/settings",
          { method: "PUT", body: JSON.stringify({ historyRetentionDays: 0 }) },
          owner,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          "/api/settings",
          {
            method: "PUT",
            body: JSON.stringify({ historyRetentionDays: 3651 }),
          },
          owner,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          "/api/settings",
          {
            method: "PUT",
            body: JSON.stringify({ historyRetentionDays: 90 }),
          },
          owner,
        )
      ).status,
    ).toBe(200);
  });

  it("deletes only buckets and finished outages fully outside the window", async () => {
    const now = Date.UTC(2026, 0, 15, 12);
    const cutoff = retentionCutoff(now, 7);
    const keptFrom = firstRetainedDay(cutoff);
    const monitorId = crypto.randomUUID();
    await insertMonitor(monitorId);
    const hour = async (start: number) => {
      await env.DB.prepare(
        `INSERT INTO uptime_hourly (
          monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
        ) VALUES (?, ?, 1, 0, 10, 10, '[]')`,
      )
        .bind(monitorId, start)
        .run();
    };
    const day = async (start: number) => {
      await env.DB.prepare(
        `INSERT INTO uptime_daily (
          monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max
        ) VALUES (?, ?, 1, 0, 10, 10)`,
      )
        .bind(monitorId, start)
        .run();
    };
    const outage = async (endedAt: number | null, startedAt: number) => {
      await env.DB.prepare(
        `INSERT INTO outages (id, monitor_id, started_at, ended_at, cause)
         VALUES (?, ?, ?, ?, 'timeout')`,
      )
        .bind(crypto.randomUUID(), monitorId, startedAt, endedAt)
        .run();
    };
    await hour(keptFrom - HOUR_MS);
    await hour(keptFrom);
    const slot = async (start: number) => {
      await env.DB.prepare(
        `INSERT INTO uptime_slots (
          monitor_id, slot_start, ok_count, fail_count, latency_sum, latency_max
        ) VALUES (?, ?, 1, 0, 10, 10)`,
      )
        .bind(monitorId, start)
        .run();
    };
    await slot(keptFrom - SLOT_MS);
    await slot(keptFrom);
    await day(keptFrom - DAY_MS);
    await day(keptFrom);
    await outage(cutoff - 1, cutoff - DAY_MS);
    await outage(cutoff, cutoff - HOUR_MS);
    await outage(null, 0);

    await writeSetting(env, HISTORY_RETENTION_KEY, 7);
    await resetPruneClock();
    const result = await pruneHistory(env, now);
    expect(result.skipped).toBe(false);
    expect(result.slots).toBeGreaterThanOrEqual(1);
    expect(result.hourly).toBeGreaterThanOrEqual(1);
    expect(result.daily).toBeGreaterThanOrEqual(1);
    expect(result.outages).toBeGreaterThanOrEqual(1);

    const hours = await env.DB.prepare(
      "SELECT hour_start AS start FROM uptime_hourly WHERE monitor_id = ? ORDER BY hour_start",
    )
      .bind(monitorId)
      .all<{ start: number }>();
    expect(hours.results.map((row) => row.start)).toEqual([keptFrom]);
    const slots = await env.DB.prepare(
      "SELECT slot_start AS start FROM uptime_slots WHERE monitor_id = ? ORDER BY slot_start",
    )
      .bind(monitorId)
      .all<{ start: number }>();
    expect(slots.results.map((row) => row.start)).toEqual([keptFrom]);
    const days = await env.DB.prepare(
      "SELECT day_start AS start FROM uptime_daily WHERE monitor_id = ? ORDER BY day_start",
    )
      .bind(monitorId)
      .all<{ start: number }>();
    expect(days.results.map((row) => row.start)).toEqual([keptFrom]);
    const outages = await env.DB.prepare(
      "SELECT ended_at AS ended FROM outages WHERE monitor_id = ? ORDER BY started_at",
    )
      .bind(monitorId)
      .all<{ ended: number | null }>();
    expect(outages.results.map((row) => row.ended)).toEqual([null, cutoff]);
  });

  it("deletes at most one batch and continues on the next catch-up run", async () => {
    const now = Date.UTC(2026, 3, 2, 8);
    const monitorId = crypto.randomUUID();
    await insertMonitor(monitorId);
    const total = PRUNE_BATCH + 5;
    for (let index = 0; index < total; index += 1) {
      await env.DB.prepare(
        `INSERT INTO uptime_hourly (
          monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
        ) VALUES (?, ?, 1, 0, 1, 1, '[]')`,
      )
        .bind(monitorId, index)
        .run();
    }
    await writeSetting(env, HISTORY_RETENTION_KEY, 7);
    await resetPruneClock();
    let left = total;
    let sawFullBatch = false;
    let finishedAt = now;
    for (let step = 0; step < 30; step += 1) {
      const at = now + step * PRUNE_CATCHUP_INTERVAL_MS;
      const result = await pruneHistory(env, at);
      expect(result.hourly).toBeLessThanOrEqual(PRUNE_BATCH);
      expect(result.daily).toBeLessThanOrEqual(PRUNE_BATCH);
      expect(result.outages).toBeLessThanOrEqual(PRUNE_BATCH);
      if (result.skipped) continue;
      if (result.hourly === PRUNE_BATCH) sawFullBatch = true;
      const next = await countRows("uptime_hourly", monitorId);
      expect(left - next).toBeLessThanOrEqual(PRUNE_BATCH);
      left = next;
      finishedAt = at;
      if (left === 0) break;
      expect(result.caughtUp).toBe(false);
    }
    expect(sawFullBatch).toBe(true);
    expect(left).toBe(0);
    const followUp = await pruneHistory(env, finishedAt + 60_000);
    expect(followUp.skipped).toBe(true);
  });

  it("stops deleting once the daily cap is reached", async () => {
    const now = Date.UTC(2026, 4, 3, 9);
    const monitorId = crypto.randomUUID();
    await insertMonitor(monitorId);
    await env.DB.prepare(
      `INSERT INTO uptime_hourly (
        monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
      ) VALUES (?, 0, 1, 0, 1, 1, '[]')`,
    )
      .bind(monitorId)
      .run();
    await writeSetting(env, HISTORY_PRUNE_STATE_KEY, {
      at: now,
      dayStart: utcDayStart(now),
      deleted: PRUNE_DAILY_CAP,
      caughtUp: false,
    });
    const result = await pruneHistory(env, now + PRUNE_CATCHUP_INTERVAL_MS);
    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(0);
    expect(await countRows("uptime_hourly", monitorId)).toBe(1);
  });

  it("defaults an existing status page row to 24 hours", async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO status_pages (
        id, organization_id, slug, published,
        default_locale, locales_json, source_locale,
        title, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 'en', '["en"]', 'en', 'Legacy page', ?, ?)`,
    )
      .bind(id, crypto.randomUUID(), `legacy-${id.slice(0, 8)}`, now, now)
      .run();
    const row = await env.DB.prepare(
      "SELECT display_range AS displayRange FROM status_pages WHERE id = ?",
    )
      .bind(id)
      .first<{ displayRange: string }>();
    expect(row?.displayRange).toBe("24h");
  });
});

describe("status page display range", () => {
  it("aggregates 24 hour and 7 day windows and clamps to retention", async () => {
    const owner = await ownerSession();
    const monitor = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Range heartbeat",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
        }),
      },
      owner,
    );
    expect(monitor.status).toBe(201);
    const monitorId = ((await monitor.json()) as { id: string }).id;
    const now = Date.now();
    const today = utcDayStart(now);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    await env.DB.prepare(
      `INSERT INTO uptime_daily (
        monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max
      ) VALUES (?, ?, 9, 1, 100, 20)`,
    )
      .bind(monitorId, today - DAY_MS)
      .run();
    const earlierHour = hour - HOUR_MS;
    await env.DB.prepare(
      `INSERT INTO uptime_hourly (
        monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json
      ) VALUES (?, ?, 1, 0, 40, 40, '[40]')`,
    )
      .bind(monitorId, earlierHour)
      .run();

    const week = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: `week-${monitorId.slice(0, 8)}`,
          published: true,
          title: "Week",
          displayRange: "7d",
          items: [
            {
              monitorId,
              position: 0,
              groupName: "Core",
              displayName: "Range",
            },
          ],
        }),
      },
      owner,
    );
    expect(week.status).toBe(201);
    const weekId = ((await week.json()) as { id: string }).id;
    const detail = (await (
      await api(`/api/status-pages/${weekId}`, {}, owner)
    ).json()) as { displayRange: string };
    expect(detail.displayRange).toBe("7d");

    await writeSetting(env, HISTORY_RETENTION_KEY, 90);
    const body = (await (
      await api(`/api/public/status/week-${monitorId.slice(0, 8)}`)
    ).json()) as {
      displayRange: string;
      bucket: string;
      barCount: number;
      clamped: boolean;
      retentionDays: number;
      groups: {
        items: {
          uptime: number | null;
          responseMs: number | null;
          bars: {
            start: number;
            uptime: number | null;
            responseMs: number | null;
          }[];
        }[];
      }[];
    };
    expect(body.displayRange).toBe("7d");
    expect(body.bucket).toBe("hour");
    expect(body.barCount).toBe(84);
    expect(body.clamped).toBe(false);
    expect(body.retentionDays).toBe(90);
    const item = body.groups[0]?.items[0];
    expect(item?.bars).toHaveLength(84);
    const yesterday = item?.bars.find((bar) => bar.start === today - DAY_MS);
    expect(yesterday).toMatchObject({ uptime: 90, responseMs: 10 });
    expect(item?.uptime).not.toBeNull();

    const dayPage = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: `day-${monitorId.slice(0, 8)}`,
          published: true,
          title: "Day",
          items: [
            {
              monitorId,
              position: 0,
              groupName: "",
              displayName: "Range",
            },
          ],
        }),
      },
      owner,
    );
    expect(dayPage.status).toBe(201);
    const dayBody = (await (
      await api(`/api/public/status/day-${monitorId.slice(0, 8)}`)
    ).json()) as {
      displayRange: string;
      bucket: string;
      barCount: number;
      clamped: boolean;
      groups: {
        items: { bars: { start: number; uptime: number | null }[] }[];
      }[];
    };
    expect(dayBody.displayRange).toBe("24h");
    expect(dayBody.bucket).toBe("slot");
    expect(dayBody.clamped).toBe(false);
    expect(dayBody.barCount).toBe(96);
    expect(dayBody.groups[0]?.items[0]?.bars).toHaveLength(96);
    const hourBar = dayBody.groups[0]?.items[0]?.bars.find(
      (bar) => bar.start === earlierHour,
    );
    expect(hourBar).toMatchObject({ uptime: 100 });

    await writeSetting(env, HISTORY_RETENTION_KEY, 7);
    const wide = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: `wide-${monitorId.slice(0, 8)}`,
          published: true,
          title: "Wide",
          displayRange: "90d",
          items: [
            {
              monitorId,
              position: 0,
              groupName: "",
              displayName: "Range",
            },
          ],
        }),
      },
      owner,
    );
    expect(wide.status).toBe(201);
    const wideBody = (await (
      await api(`/api/public/status/wide-${monitorId.slice(0, 8)}`)
    ).json()) as {
      bucket: string;
      barCount: number;
      clamped: boolean;
      retentionDays: number;
      displayRange: string;
    };
    expect(wideBody).toMatchObject({
      displayRange: "90d",
      bucket: "day",
      barCount: 7,
      clamped: true,
      retentionDays: 7,
    });

    expect(
      (
        await api(
          "/api/status-pages",
          {
            method: "POST",
            body: JSON.stringify({
              slug: `bad-${monitorId.slice(0, 8)}`,
              published: true,
              title: "Bad",
              displayRange: "10d",
              items: [],
            }),
          },
          owner,
        )
      ).status,
    ).toBe(400);

    await writeSetting(env, HISTORY_RETENTION_KEY, 90);
  });
});
