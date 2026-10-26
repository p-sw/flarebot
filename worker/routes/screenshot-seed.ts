// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { t } from "../../shared/copy";
import { getDb } from "../db/client";
import { monitors } from "../db/schema";
import {
  ApiError,
  type AppEnv,
  assertMutationOrigin,
  parseBody,
  requireActor,
  requireCan,
} from "../http";
import { schedulerStub } from "../monitors/sync";
import { ownedMonitor } from "./monitors";

const pointSchema = z.object({
  t: z.number().int().positive(),
  ok: z.boolean(),
  ms: z.number().int().min(0).max(120_000),
});

const seedSchema = z.object({
  monitors: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["up", "down", "pending", "paused"]),
        lastResponseMs: z.number().int().min(0).max(120_000).nullable(),
        lastError: z.string().max(200).nullable(),
        points: z.array(pointSchema).max(60),
      }),
    )
    .min(1)
    .max(12),
});

// Local README screenshots call this after creating paused monitors. The
// preview script sets FLAREBOT_SCREENSHOTS=1 in .dev.vars, copies that file
// to dist/flarebot/.dev.vars (the file vite preview reads), and removes the
// line on exit. Without that value the route is a 404 and does not touch D1
// or a Durable Object.
export function registerScreenshotSeed(app: Hono<AppEnv>): void {
  app.post("/api/dev/screenshot-history", async (c) => {
    if (c.env.FLAREBOT_SCREENSHOTS !== "1") {
      throw new ApiError(404, "not_found", t("error_not_found"));
    }
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "monitors.write");
    const body = await parseBody(c, seedSchema);
    const now = Date.now();
    const db = getDb(c.env.DB);
    for (const item of body.monitors) {
      const row = await ownedMonitor(c.env, actor.organizationId, item.id);
      const paused = item.status === "paused";
      const seeded = await schedulerStub(c.env, row.shardId).seedDemo(row.id, {
        paused,
        status: item.status,
        lastResponseMs: item.lastResponseMs,
        lastError: item.lastError,
        points: item.points,
        now,
      });
      if (!seeded) throw new ApiError(404, "not_found", t("error_not_found"));
      await db
        .update(monitors)
        .set({ paused, updatedAt: now })
        .where(eq(monitors.id, row.id));
    }
    return c.json({ ok: true });
  });
}
