// SPDX-License-Identifier: AGPL-3.0-only

import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  mergeHourly,
  percentile,
  rollDaily,
} from "../worker/scheduler/persist";

describe("rollups", () => {
  it("merges hourly samples, caps retention, and skips today when rolling daily", async () => {
    const id = crypto.randomUUID();
    const hour = Date.UTC(2024, 5, 1, 3);
    await mergeHourly(env.DB, id, {
      hourStart: hour,
      ok: 2,
      fail: 1,
      sum: 30,
      max: 20,
      samples: [10, 20],
    });
    await mergeHourly(env.DB, id, {
      hourStart: hour,
      ok: 1,
      fail: 0,
      sum: 5,
      max: 5,
      samples: Array.from({ length: 130 }, (_, index) => index),
    });
    const row = await env.DB.prepare(
      "SELECT ok_count, fail_count, latency_sum, latency_max, samples_json FROM uptime_hourly WHERE monitor_id = ?",
    )
      .bind(id)
      .first<{
        ok_count: number;
        fail_count: number;
        latency_sum: number;
        latency_max: number;
        samples_json: string;
      }>();
    expect(row?.ok_count).toBe(3);
    expect(row?.fail_count).toBe(1);
    expect(row?.latency_sum).toBe(35);
    expect(row?.latency_max).toBe(20);
    expect(JSON.parse(row?.samples_json ?? "[]")).toHaveLength(120);

    const today = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    await mergeHourly(env.DB, id, {
      hourStart: today,
      ok: 4,
      fail: 0,
      sum: 4,
      max: 1,
      samples: [1],
    });
    await rollDaily(env.DB, today + 3_600_000);
    const daily = await env.DB.prepare(
      "SELECT ok_count FROM uptime_daily WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(id, Date.UTC(2024, 5, 1))
      .first<{ ok_count: number }>();
    expect(daily?.ok_count).toBe(3);
    const todayRow = await env.DB.prepare(
      "SELECT ok_count FROM uptime_daily WHERE monitor_id = ? AND day_start = ?",
    )
      .bind(id, today)
      .first<{ ok_count: number }>();
    expect(todayRow).toBeNull();
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 95)).toBe(0);
  });

  it("applies the migration set twice without dropping tables", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>();
    const names = new Set(tables.results.map((row) => row.name));
    for (const name of [
      "organizations",
      "users",
      "monitors",
      "outages",
      "uptime_hourly",
      "uptime_daily",
      "mail_outbox",
      "api_tokens",
      "status_pages",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    expect(names.has("subscribers")).toBe(false);
    expect(names.has("incidents")).toBe(false);
  });
});
