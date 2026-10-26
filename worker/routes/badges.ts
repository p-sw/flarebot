// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import {
  badgeQueryFrom,
  normalizeBadgeMonitorId,
  parseBadgeKind,
} from "../../shared/badge-link";
import { t } from "../../shared/copy";
import { can } from "../../shared/permissions";
import { previewBadgeResponse, publicBadgeResponse } from "../badges/serve";
import { getDb } from "../db/client";
import { monitors } from "../db/schema";
import {
  ApiError,
  type AppEnv,
  assertMutationOrigin,
  audit,
  clientIp,
  requireActor,
  requireCan,
} from "../http";
import { ownedMonitor, readMonitor } from "./monitors";

const toggleSchema = z.object({ enabled: z.boolean() });

export function registerBadges(app: Hono<AppEnv>): void {
  app.on(["GET", "HEAD"], "/badge/:id/:file", (c) => {
    const id = normalizeBadgeMonitorId(c.req.param("id"));
    const kind = parseBadgeKind(c.req.param("file"));
    return publicBadgeResponse(
      c,
      id,
      kind,
      badgeQueryFrom(new URL(c.req.url).searchParams),
    );
  });

  app.on(["GET", "HEAD"], "/api/monitors/:id/badges/preview.svg", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "monitors.read");
    const row = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const kind = parseBadgeKind(
      `${new URL(c.req.url).searchParams.get("kind") ?? "status"}.svg`,
    );
    if (!kind) throw new ApiError(400, "validation", t("error_validation"));
    return previewBadgeResponse(
      c,
      row.id,
      kind,
      badgeQueryFrom(new URL(c.req.url).searchParams),
    );
  });

  app.patch("/api/monitors/:id/badges", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "monitors.write");
    const current = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = toggleSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      throw new ApiError(400, "validation", t("error_validation"));
    if (current.badgesEnabled !== body.data.enabled) {
      await getDb(c.env.DB)
        .update(monitors)
        .set({ badgesEnabled: body.data.enabled, updatedAt: Date.now() })
        .where(eq(monitors.id, current.id));
      await audit(
        c.env,
        actor,
        "monitor.badges",
        current.id,
        { enabled: current.badgesEnabled },
        { enabled: body.data.enabled },
        clientIp(c),
      );
    }
    return c.json(
      await readMonitor(
        c,
        actor.organizationId,
        current.id,
        can(actor, "monitors.write"),
      ),
    );
  });
}
