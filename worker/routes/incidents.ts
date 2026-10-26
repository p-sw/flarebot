// SPDX-License-Identifier: MIT

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { announcementHref } from "../../shared/announcements";
import { t } from "../../shared/copy";
import {
  type Impact,
  type IncidentStatus,
  isIncidentStatus,
  latestByPostedAt,
} from "../../shared/impact";
import {
  incidentResolveSchema,
  incidentUpdateSchema,
  incidentWriteSchema,
} from "../../shared/schemas";
import { publishAnnouncement } from "../announce/publish";
import { getDb } from "../db/client";
import {
  incidentChannels,
  incidentMonitors,
  incidentPages,
  incidents,
  incidentUpdates,
  monitors,
  notificationChannels,
  outages,
  statusPageItems,
  statusPages,
} from "../db/schema";
import {
  type Actor,
  ApiError,
  type AppEnv,
  assertMutationOrigin,
  audit,
  clientIp,
  parseBody,
  requireActor,
  requireCan,
} from "../http";
import { loadPublicIncident } from "../status/announcements";

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function assertPostedAt(postedAt: number): void {
  const now = Date.now();
  if (postedAt < now - TEN_YEARS_MS || postedAt > now + 5 * 60_000) {
    throw new ApiError(400, "validation", t("error_validation"));
  }
}

function summaryOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 500);
}

function uniqueMonitors(
  rows: { monitorId: string; impact: Impact }[],
): { monitorId: string; impact: Impact }[] {
  const map = new Map<string, Impact>();
  for (const row of rows) map.set(row.monitorId, row.impact);
  return [...map.entries()].map(([monitorId, impact]) => ({
    monitorId,
    impact,
  }));
}

async function assertLinks(
  env: Env,
  organizationId: string,
  monitorIds: string[],
  pageIds: string[],
  channelIds: string[],
): Promise<void> {
  const db = getDb(env.DB);
  const monitorsFound = monitorIds.length
    ? await db
        .select({ id: monitors.id })
        .from(monitors)
        .where(
          and(
            eq(monitors.organizationId, organizationId),
            inArray(monitors.id, monitorIds),
          ),
        )
    : [];
  const pagesFound = pageIds.length
    ? await db
        .select({ id: statusPages.id })
        .from(statusPages)
        .where(
          and(
            eq(statusPages.organizationId, organizationId),
            inArray(statusPages.id, pageIds),
          ),
        )
    : [];
  const channelsFound = channelIds.length
    ? await db
        .select({ id: notificationChannels.id })
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.organizationId, organizationId),
            inArray(notificationChannels.id, channelIds),
          ),
        )
    : [];
  if (
    monitorsFound.length !== new Set(monitorIds).size ||
    pagesFound.length !== new Set(pageIds).size ||
    channelsFound.length !== new Set(channelIds).size
  ) {
    throw new ApiError(400, "validation", t("error_validation"));
  }
}

async function replaceLinks(
  env: Env,
  incidentId: string,
  monitorRows: { monitorId: string; impact: Impact }[],
  pageIds: string[],
  channelIds: string[],
): Promise<void> {
  const db = getDb(env.DB);
  await db
    .delete(incidentMonitors)
    .where(eq(incidentMonitors.incidentId, incidentId));
  await db
    .delete(incidentPages)
    .where(eq(incidentPages.incidentId, incidentId));
  await db
    .delete(incidentChannels)
    .where(eq(incidentChannels.incidentId, incidentId));
  if (monitorRows.length) {
    await db.insert(incidentMonitors).values(
      monitorRows.map((row) => ({
        incidentId,
        monitorId: row.monitorId,
        impact: row.impact,
      })),
    );
  }
  if (pageIds.length) {
    await db
      .insert(incidentPages)
      .values(pageIds.map((pageId) => ({ incidentId, pageId })));
  }
  if (channelIds.length) {
    await db
      .insert(incidentChannels)
      .values(channelIds.map((channelId) => ({ incidentId, channelId })));
  }
}

async function hrefFor(env: Env, pageIds: string[], incidentId: string) {
  if (pageIds.length === 0) return null;
  const page = await getDb(env.DB)
    .select({ slug: statusPages.slug })
    .from(statusPages)
    .where(eq(statusPages.id, pageIds[0] ?? ""))
    .get();
  return announcementHref("incident", page?.slug ?? null, incidentId);
}

async function publishIncident(
  env: Env,
  input: {
    kind: "incident.created" | "incident.updated" | "incident.resolved";
    organizationId: string;
    incidentId: string;
    title: string;
    summary: string;
    notify: boolean;
    channelIds: string[];
    pageIds: string[];
    occurredAt: number;
  },
): Promise<void> {
  await publishAnnouncement(
    env.DB,
    {
      kind: input.kind,
      organizationId: input.organizationId,
      subjectType: "incident",
      subjectId: input.incidentId,
      title: input.title,
      summary: input.summary,
      occurredAt: input.occurredAt,
      href: await hrefFor(env, input.pageIds, input.incidentId),
    },
    input.notify ? input.channelIds : [],
  );
}

async function loadIncident(env: Env, organizationId: string, id: string) {
  const db = getDb(env.DB);
  const incident = await db
    .select()
    .from(incidents)
    .where(
      and(eq(incidents.id, id), eq(incidents.organizationId, organizationId)),
    )
    .get();
  if (!incident) throw new ApiError(404, "not_found", t("error_not_found"));
  const [
    monitorRows,
    pageRows,
    channelRows,
    updates,
    monitorNames,
    pageNames,
    channelNames,
  ] = await Promise.all([
    db
      .select()
      .from(incidentMonitors)
      .where(eq(incidentMonitors.incidentId, incident.id)),
    db
      .select()
      .from(incidentPages)
      .where(eq(incidentPages.incidentId, incident.id)),
    db
      .select()
      .from(incidentChannels)
      .where(eq(incidentChannels.incidentId, incident.id)),
    db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, incident.id)),
    db
      .select({ id: monitors.id, name: monitors.name })
      .from(monitors)
      .where(eq(monitors.organizationId, organizationId)),
    db
      .select({
        id: statusPages.id,
        title: statusPages.title,
        slug: statusPages.slug,
      })
      .from(statusPages)
      .where(eq(statusPages.organizationId, organizationId)),
    db
      .select({ id: notificationChannels.id, name: notificationChannels.name })
      .from(notificationChannels)
      .where(eq(notificationChannels.organizationId, organizationId)),
  ]);
  const names = new Map(monitorNames.map((row) => [row.id, row.name]));
  const pages = new Map(pageNames.map((row) => [row.id, row]));
  const channels = new Map(channelNames.map((row) => [row.id, row.name]));
  const ordered = [...updates].sort(
    (left, right) =>
      left.postedAt - right.postedAt || left.createdAt - right.createdAt,
  );
  const latest = latestByPostedAt(ordered);
  const status: IncidentStatus =
    latest && isIncidentStatus(latest.status) ? latest.status : "investigating";
  return {
    id: incident.id,
    title: incident.title,
    notify: incident.notify,
    resolvedAt: incident.resolvedAt,
    status,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    sourceOutageId: incident.sourceOutageId,
    monitors: monitorRows.map((row) => ({
      monitorId: row.monitorId,
      name: names.get(row.monitorId) ?? "",
      impact: row.impact,
    })),
    pages: pageRows.flatMap((row) => {
      const page = pages.get(row.pageId);
      return page
        ? [{ pageId: page.id, title: page.title, slug: page.slug }]
        : [];
    }),
    channels: channelRows.map((row) => ({
      channelId: row.channelId,
      name: channels.get(row.channelId) ?? "",
    })),
    updates: ordered.map((update) => ({
      id: update.id,
      status: update.status,
      body: update.body,
      postedAt: update.postedAt,
      createdAt: update.createdAt,
      updatedAt: update.updatedAt,
    })),
  };
}

async function syncResolved(env: Env, incidentId: string) {
  const db = getDb(env.DB);
  const current = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .get();
  const updates = await db
    .select()
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incidentId));
  const latest = latestByPostedAt(updates);
  const resolvedAt = latest?.status === "resolved" ? latest.postedAt : null;
  await db
    .update(incidents)
    .set({ resolvedAt, updatedAt: Date.now() })
    .where(eq(incidents.id, incidentId));
  return {
    wasResolved: current?.resolvedAt != null,
    resolvedAt,
    latest,
  };
}

function editor(actor: Actor) {
  requireCan(actor, "incidents.write");
}

export function registerIncidents(app: Hono<AppEnv>): void {
  app.get("/api/incidents", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "incidents.read");
    const resolved = c.req.query("state") === "resolved";
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.organizationId, actor.organizationId),
          resolved
            ? isNotNull(incidents.resolvedAt)
            : isNull(incidents.resolvedAt),
        ),
      )
      .orderBy(desc(incidents.updatedAt))
      .limit(100);
    const ids = rows.map((row) => row.id);
    const updates = ids.length
      ? await db
          .select()
          .from(incidentUpdates)
          .where(inArray(incidentUpdates.incidentId, ids))
      : [];
    return c.json({
      incidents: rows.map((row) => {
        const latest = latestByPostedAt(
          updates.filter((update) => update.incidentId === row.id),
        );
        return {
          id: row.id,
          title: row.title,
          status:
            latest && isIncidentStatus(latest.status)
              ? latest.status
              : "investigating",
          resolvedAt: row.resolvedAt,
          updatedAt: row.updatedAt,
          message: latest?.body ?? "",
        };
      }),
    });
  });

  app.post("/api/incidents", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const body = await parseBody(c, incidentWriteSchema);
    if (!body.update)
      throw new ApiError(400, "validation", t("error_validation"));
    assertPostedAt(body.update.postedAt);
    const monitorRows = uniqueMonitors(body.monitors);
    const pageIds = [...new Set(body.pageIds)];
    const channelIds = [...new Set(body.channelIds)];
    await assertLinks(
      c.env,
      actor.organizationId,
      monitorRows.map((row) => row.monitorId),
      pageIds,
      channelIds,
    );
    const db = getDb(c.env.DB);
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.insert(incidents).values({
      id,
      organizationId: actor.organizationId,
      title: body.title,
      notify: body.notify,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      resolvedAt:
        body.update.status === "resolved" ? body.update.postedAt : null,
      sourceOutageId: null,
    });
    await replaceLinks(c.env, id, monitorRows, pageIds, channelIds);
    await db.insert(incidentUpdates).values({
      id: crypto.randomUUID(),
      incidentId: id,
      status: body.update.status,
      body: body.update.body,
      postedAt: body.update.postedAt,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(
      c.env,
      actor,
      "incident.create",
      id,
      null,
      { title: body.title },
      clientIp(c),
    );
    await publishIncident(c.env, {
      kind:
        body.update.status === "resolved"
          ? "incident.resolved"
          : "incident.created",
      organizationId: actor.organizationId,
      incidentId: id,
      title: body.title,
      summary: summaryOf(body.update.body),
      notify: body.notify,
      channelIds,
      pageIds,
      occurredAt: now,
    });
    return c.json(await loadIncident(c.env, actor.organizationId, id), 201);
  });

  app.post("/api/incidents/from-outage/:outageId", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const db = getDb(c.env.DB);
    const outage = await db
      .select()
      .from(outages)
      .where(eq(outages.id, c.req.param("outageId")))
      .get();
    if (!outage) throw new ApiError(404, "not_found", t("error_not_found"));
    const monitor = await db
      .select()
      .from(monitors)
      .where(
        and(
          eq(monitors.id, outage.monitorId),
          eq(monitors.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!monitor) throw new ApiError(404, "not_found", t("error_not_found"));
    const existing = await db
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.sourceOutageId, outage.id))
      .get();
    if (existing) {
      return c.json(
        await loadIncident(c.env, actor.organizationId, existing.id),
      );
    }
    const pages = await db
      .select({ pageId: statusPageItems.pageId })
      .from(statusPageItems)
      .innerJoin(statusPages, eq(statusPages.id, statusPageItems.pageId))
      .where(
        and(
          eq(statusPageItems.monitorId, monitor.id),
          eq(statusPages.organizationId, actor.organizationId),
        ),
      );
    const pageIds = [...new Set(pages.map((row) => row.pageId))];
    const now = Date.now();
    const id = crypto.randomUUID();
    const title = t("incident_from_outage_title", { name: monitor.name });
    const message = t("incident_from_outage_body", {
      cause: outage.cause || t("outage_cause"),
    });
    try {
      await db.insert(incidents).values({
        id,
        organizationId: actor.organizationId,
        title,
        notify: false,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        sourceOutageId: outage.id,
      });
    } catch {
      const raced = await db
        .select({ id: incidents.id })
        .from(incidents)
        .where(eq(incidents.sourceOutageId, outage.id))
        .get();
      if (raced)
        return c.json(
          await loadIncident(c.env, actor.organizationId, raced.id),
        );
      throw new ApiError(409, "conflict", t("error_validation"));
    }
    await replaceLinks(
      c.env,
      id,
      [{ monitorId: monitor.id, impact: "major_outage" }],
      pageIds,
      [],
    );
    await db.insert(incidentUpdates).values({
      id: crypto.randomUUID(),
      incidentId: id,
      status: "investigating",
      body: message,
      postedAt: outage.startedAt,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(
      c.env,
      actor,
      "incident.from_outage",
      id,
      { outageId: outage.id },
      { title },
      clientIp(c),
    );
    await publishIncident(c.env, {
      kind: "incident.created",
      organizationId: actor.organizationId,
      incidentId: id,
      title,
      summary: summaryOf(message),
      notify: false,
      channelIds: [],
      pageIds,
      occurredAt: now,
    });
    return c.json(await loadIncident(c.env, actor.organizationId, id), 201);
  });

  app.get("/api/public/status/:slug/incidents/:incidentId", async (c) => {
    const detail = await loadPublicIncident(
      c.env,
      c.req.param("slug"),
      c.req.param("incidentId"),
    );
    if (!detail) throw new ApiError(404, "not_found", t("error_not_found"));
    return c.json(detail, 200, { "cache-control": "private, no-store" });
  });

  app.get("/api/incidents/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "incidents.read");
    return c.json(
      await loadIncident(c.env, actor.organizationId, c.req.param("id")),
    );
  });

  app.patch("/api/incidents/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, incidentWriteSchema);
    const monitorRows = uniqueMonitors(body.monitors);
    const pageIds = [...new Set(body.pageIds)];
    const channelIds = [...new Set(body.channelIds)];
    await assertLinks(
      c.env,
      actor.organizationId,
      monitorRows.map((row) => row.monitorId),
      pageIds,
      channelIds,
    );
    const db = getDb(c.env.DB);
    await db
      .update(incidents)
      .set({ title: body.title, notify: body.notify, updatedAt: Date.now() })
      .where(eq(incidents.id, current.id));
    await replaceLinks(c.env, current.id, monitorRows, pageIds, channelIds);
    await audit(
      c.env,
      actor,
      "incident.update",
      current.id,
      { title: current.title },
      { title: body.title },
      clientIp(c),
    );
    await publishIncident(c.env, {
      kind: current.resolvedAt ? "incident.updated" : "incident.updated",
      organizationId: actor.organizationId,
      incidentId: current.id,
      title: body.title,
      summary: summaryOf(current.updates.at(-1)?.body ?? body.title),
      notify: body.notify,
      channelIds,
      pageIds,
      occurredAt: Date.now(),
    });
    return c.json(await loadIncident(c.env, actor.organizationId, current.id));
  });

  app.delete("/api/incidents/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    await getDb(c.env.DB).delete(incidents).where(eq(incidents.id, current.id));
    await audit(
      c.env,
      actor,
      "incident.delete",
      current.id,
      { title: current.title },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/incidents/:id/resolve", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, incidentResolveSchema);
    const postedAt = body.postedAt ?? Date.now();
    assertPostedAt(postedAt);
    const now = Date.now();
    await getDb(c.env.DB).insert(incidentUpdates).values({
      id: crypto.randomUUID(),
      incidentId: current.id,
      status: "resolved",
      body: body.body,
      postedAt,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    const synced = await syncResolved(c.env, current.id);
    await audit(
      c.env,
      actor,
      "incident.resolve",
      current.id,
      { resolvedAt: current.resolvedAt },
      { resolvedAt: synced.resolvedAt },
      clientIp(c),
    );
    await publishIncident(c.env, {
      kind: synced.wasResolved ? "incident.updated" : "incident.resolved",
      organizationId: actor.organizationId,
      incidentId: current.id,
      title: current.title,
      summary: summaryOf(body.body),
      notify: current.notify,
      channelIds: current.channels.map((channel) => channel.channelId),
      pageIds: current.pages.map((page) => page.pageId),
      occurredAt: now,
    });
    return c.json(await loadIncident(c.env, actor.organizationId, current.id));
  });

  app.post("/api/incidents/:id/updates", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, incidentUpdateSchema);
    assertPostedAt(body.postedAt);
    const now = Date.now();
    await getDb(c.env.DB).insert(incidentUpdates).values({
      id: crypto.randomUUID(),
      incidentId: current.id,
      status: body.status,
      body: body.body,
      postedAt: body.postedAt,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    const synced = await syncResolved(c.env, current.id);
    await audit(
      c.env,
      actor,
      "incident_update.create",
      current.id,
      null,
      { status: body.status },
      clientIp(c),
    );
    const kind =
      !synced.wasResolved && synced.resolvedAt
        ? "incident.resolved"
        : "incident.updated";
    await publishIncident(c.env, {
      kind,
      organizationId: actor.organizationId,
      incidentId: current.id,
      title: current.title,
      summary: summaryOf(body.body),
      notify: current.notify,
      channelIds: current.channels.map((channel) => channel.channelId),
      pageIds: current.pages.map((page) => page.pageId),
      occurredAt: now,
    });
    return c.json(
      await loadIncident(c.env, actor.organizationId, current.id),
      201,
    );
  });

  app.patch("/api/incidents/:id/updates/:updateId", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, incidentUpdateSchema);
    assertPostedAt(body.postedAt);
    const update = current.updates.find(
      (item) => item.id === c.req.param("updateId"),
    );
    if (!update) throw new ApiError(404, "not_found", t("error_not_found"));
    const now = Date.now();
    await getDb(c.env.DB)
      .update(incidentUpdates)
      .set({
        status: body.status,
        body: body.body,
        postedAt: body.postedAt,
        updatedAt: now,
      })
      .where(eq(incidentUpdates.id, update.id));
    const synced = await syncResolved(c.env, current.id);
    await audit(
      c.env,
      actor,
      "incident_update.update",
      update.id,
      { status: update.status },
      { status: body.status },
      clientIp(c),
    );
    const kind =
      !synced.wasResolved && synced.resolvedAt
        ? "incident.resolved"
        : "incident.updated";
    await publishIncident(c.env, {
      kind,
      organizationId: actor.organizationId,
      incidentId: current.id,
      title: current.title,
      summary: summaryOf(body.body),
      notify: current.notify,
      channelIds: current.channels.map((channel) => channel.channelId),
      pageIds: current.pages.map((page) => page.pageId),
      occurredAt: now,
    });
    return c.json(await loadIncident(c.env, actor.organizationId, current.id));
  });

  app.delete("/api/incidents/:id/updates/:updateId", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    editor(actor);
    const current = await loadIncident(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    if (current.updates.length <= 1) {
      throw new ApiError(400, "validation", t("incident_update_last"));
    }
    const update = current.updates.find(
      (item) => item.id === c.req.param("updateId"),
    );
    if (!update) throw new ApiError(404, "not_found", t("error_not_found"));
    await getDb(c.env.DB)
      .delete(incidentUpdates)
      .where(eq(incidentUpdates.id, update.id));
    const synced = await syncResolved(c.env, current.id);
    await audit(
      c.env,
      actor,
      "incident_update.delete",
      update.id,
      { status: update.status },
      null,
      clientIp(c),
    );
    const kind =
      !synced.wasResolved && synced.resolvedAt
        ? "incident.resolved"
        : "incident.updated";
    await publishIncident(c.env, {
      kind,
      organizationId: actor.organizationId,
      incidentId: current.id,
      title: current.title,
      summary: summaryOf(update.body),
      notify: current.notify,
      channelIds: current.channels.map((channel) => channel.channelId),
      pageIds: current.pages.map((page) => page.pageId),
      occurredAt: Date.now(),
    });
    return c.json(await loadIncident(c.env, actor.organizationId, current.id));
  });
}
