// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { schedulerStub } from "../worker/monitors/sync";
import { api, ownerSession } from "./helpers";

describe("monitor spark", () => {
  it("returns the last shard samples without reading rollup tables", async () => {
    const owner = await ownerSession();
    const created = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Spark",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const row = await env.DB.prepare(
      "SELECT shard_id FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string }>();
    if (!row) throw new Error("monitor missing");
    const stamp = Date.UTC(2026, 0, 15, 12, 0, 0);
    const stub = schedulerStub(env, row.shard_id);
    await stub.noteSample(id, {
      t: stamp,
      ok: true,
      ms: 20,
      internal: false,
    });
    await stub.noteSample(id, {
      t: stamp + 1000,
      ok: false,
      ms: 40,
      internal: false,
    });

    const spark = await api(`/api/monitors/${id}/spark`, {}, owner);
    expect(spark.status).toBe(200);
    expect(spark.headers.get("cache-control")).toContain("no-store");
    const body = (await spark.json()) as {
      currentMs: number | null;
      averageMs: number | null;
      uptime: number | null;
      points: { t: number; ms: number }[];
    };
    expect(body.points.length).toBeGreaterThanOrEqual(2);
    expect(body.points.length).toBeLessThanOrEqual(60);
    expect(body.points.at(-2)).toEqual({ t: stamp, ms: 20 });
    expect(body.points.at(-1)).toEqual({ t: stamp + 1000, ms: 40 });
    expect(body.currentMs).toBe(40);
    const sum = body.points.reduce((total, point) => total + point.ms, 0);
    expect(body.averageMs).toBe(Math.round(sum / body.points.length));
    expect(body.uptime).not.toBeNull();
  });
});
