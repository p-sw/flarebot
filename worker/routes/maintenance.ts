// SPDX-License-Identifier: MIT

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { announcementHref } from "../../shared/announcements";
import { t } from "../../shared/copy";
import {
  classifySchedule,
  isValidTimeZone,
  type MaintenanceSchedule,
  nextOccurrences,
  occurrenceContaining,
  zonedParts,
} from "../../shared/recurrence";
import { maintenanceWriteSchema } from "../../shared/schemas";
import { publishAnnouncement } from "../announce/publish";
import { getDb } from "../db/client";
import {
  maintenanceChannels,
  maintenanceMonitors,
  maintenancePages,
  maintenanceSignals,
  maintenanceWindows,
  monitors,
  notificationChannels,
  statusPages,
} from "../db/schema";
import {
  ApiError,
  type AppEnv,
  assertMutationOrigin,
  audit,
  clientIp,
  parseBody,
  requireActor,
  requireCan,
} from "../http";
import { scheduleFromRow } from "../maintenance";

function summaryOf(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
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

function assertSchedule(body: {
  timezone: string;
  startAt: number;
  recurrence: string;
  weekdays: number[];
}): void {
  if (!isValidTimeZone(body.timezone)) {
    throw new ApiError(400, "validation", t("error_timezone"));
  }
  if (
    body.recurrence === "weekly" &&
    !body.weekdays.includes(zonedParts(body.startAt, body.timezone).weekday)
  ) {
    throw new ApiError(400, "validation", t("error_maintenance_weekday"));
  }
}

async function replaceLinks(
  env: Env,
  maintenanceId: string,
  monitorIds: string[],
  pageIds: string[],
  channelIds: string[],
): Promise<void> {
  const db = getDb(env.DB);
  await db
    .delete(maintenanceMonitors)
    .where(eq(maintenanceMonitors.maintenanceId, maintenanceId));
  await db
    .delete(maintenancePages)
    .where(eq(maintenancePages.maintenanceId, maintenanceId));
  await db
    .delete(maintenanceChannels)
    .where(eq(maintenanceChannels.maintenanceId, maintenanceId));
  if (monitorIds.length) {
    await db
      .insert(maintenanceMonitors)
      .values(monitorIds.map((monitorId) => ({ maintenanceId, monitorId })));
  }
  if (pageIds.length) {
    await db
      .insert(maintenancePages)
      .values(pageIds.map((pageId) => ({ maintenanceId, pageId })));
  }
  if (channelIds.length) {
    await db
      .insert(maintenanceChannels)
      .values(channelIds.map((channelId) => ({ maintenanceId, channelId })));
  }
}

async function hrefFor(env: Env, pageIds: string[], maintenanceId: string) {
  if (pageIds.length === 0) return null;
  const page = await getDb(env.DB)
    .select({ slug: statusPages.slug })
    .from(statusPages)
    .where(eq(statusPages.id, pageIds[0] ?? ""))
    .get();
  return announcementHref("maintenance", page?.slug ?? null, maintenanceId);
}

async function loadWindow(env: Env, organizationId: string, id: string) {
  const db = getDb(env.DB);
  const window = await db
    .select()
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.id, id),
        eq(maintenanceWindows.organizationId, organizationId),
      ),
    )
    .get();
  if (!window) throw new ApiError(404, "not_found", t("error_not_found"));
  const [monitorRows, pageRows, channelRows, monitorNames, pageNames] =
    await Promise.all([
      db
        .select()
        .from(maintenanceMonitors)
        .where(eq(maintenanceMonitors.maintenanceId, window.id)),
      db
        .select()
        .from(maintenancePages)
        .where(eq(maintenancePages.maintenanceId, window.id)),
      db
        .select()
        .from(maintenanceChannels)
        .where(eq(maintenanceChannels.maintenanceId, window.id)),
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
    ]);
  const names = new Map(monitorNames.map((row) => [row.id, row.name]));
  const pages = new Map(pageNames.map((row) => [row.id, row]));
  const schedule = scheduleFromRow(window);
  const now = Date.now();
  const next = schedule ? (nextOccurrences(schedule, now, 1)[0] ?? null) : null;
  let weekdays: number[] = [];
  try {
    const parsed = JSON.parse(window.weekdaysJson) as unknown;
    if (Array.isArray(parsed)) {
      weekdays = parsed.filter(
        (item): item is number => typeof item === "number",
      );
    }
  } catch {
    weekdays = [];
  }
  return {
    id: window.id,
    title: window.title,
    description: window.description,
    timezone: window.timezone,
    startAt: window.startAt,
    endAt: window.endAt,
    recurrence: window.recurrence,
    weekdays,
    notify: window.notify,
    cancelledAt: window.cancelledAt,
    createdAt: window.createdAt,
    updatedAt: window.updatedAt,
    state: schedule ? classifySchedule(schedule, now) : "past",
    next,
    monitorIds: monitorRows.map((row) => row.monitorId),
    pageIds: pageRows.map((row) => row.pageId),
    channelIds: channelRows.map((row) => row.channelId),
    monitors: monitorRows.map((row) => ({
      id: row.monitorId,
      name: names.get(row.monitorId) ?? "",
    })),
    pages: pageRows.flatMap((row) => {
      const page = pages.get(row.pageId);
      return page ? [{ id: page.id, title: page.title, slug: page.slug }] : [];
    }),
  };
}

async function announce(
  env: Env,
  input: {
    kind: "maintenance.scheduled" | "maintenance.started";
    organizationId: string;
    id: string;
    title: string;
    description: string;
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
      subjectType: "maintenance",
      subjectId: input.id,
      title: input.title,
      summary: summaryOf(input.description || input.title),
      occurredAt: input.occurredAt,
      href: await hrefFor(env, input.pageIds, input.id),
    },
    input.notify ? input.channelIds : [],
  );
}

async function signalStarted(
  env: Env,
  schedule: MaintenanceSchedule,
  input: {
    id: string;
    organizationId: string;
    title: string;
    description: string;
    notify: boolean;
    channelIds: string[];
    pageIds: string[];
  },
): Promise<void> {
  const now = Date.now();
  const active = occurrenceContaining(schedule, now);
  if (!active) {
    const upcoming = nextOccurrences(schedule, now, 1)[0];
    if (upcoming && upcoming.start > now) {
      await announce(env, {
        kind: "maintenance.scheduled",
        organizationId: input.organizationId,
        id: input.id,
        title: input.title,
        description: input.description,
        notify: input.notify,
        channelIds: input.channelIds,
        pageIds: input.pageIds,
        occurredAt: now,
      });
    }
    return;
  }
  const db = getDb(env.DB);
  const existing = await db
    .select({ kind: maintenanceSignals.kind })
    .from(maintenanceSignals)
    .where(
      and(
        eq(maintenanceSignals.maintenanceId, input.id),
        eq(maintenanceSignals.occurrenceStart, active.start),
        eq(maintenanceSignals.kind, "started"),
      ),
    )
    .get();
  if (existing) return;
  await announce(env, {
    kind: "maintenance.started",
    organizationId: input.organizationId,
    id: input.id,
    title: input.title,
    description: input.description,
    notify: input.notify,
    channelIds: input.channelIds,
    pageIds: input.pageIds,
    occurredAt: active.start,
  });
  await db.insert(maintenanceSignals).values({
    maintenanceId: input.id,
    occurrenceStart: active.start,
    kind: "started",
    createdAt: now,
  });
}

export function registerMaintenance(app: Hono<AppEnv>): void {
  app.get("/api/maintenance", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "maintenance.read");
    const view = c.req.query("view");
    const wanted =
      view === "active" || view === "past" || view === "upcoming"
        ? view
        : "upcoming";
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(maintenanceWindows)
      .where(eq(maintenanceWindows.organizationId, actor.organizationId))
      .orderBy(asc(maintenanceWindows.startAt))
      .limit(200);
    const now = Date.now();
    const windows = rows.flatMap((row) => {
      const schedule = scheduleFromRow(row);
      if (!schedule) return [];
      const state = classifySchedule(schedule, now);
      if (state !== wanted) return [];
      const next = nextOccurrences(schedule, now, 1)[0] ?? null;
      return [
        {
          id: row.id,
          title: row.title,
          description: row.description,
          timezone: row.timezone,
          startAt: row.startAt,
          endAt: row.endAt,
          recurrence: row.recurrence,
          notify: row.notify,
          cancelledAt: row.cancelledAt,
          state,
          next,
        },
      ];
    });
    return c.json({ windows });
  });

  app.post("/api/maintenance", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "maintenance.write");
    const body = await parseBody(c, maintenanceWriteSchema);
    assertSchedule(body);
    const monitorIds = [...new Set(body.monitorIds)];
    const pageIds = [...new Set(body.pageIds)];
    const channelIds = [...new Set(body.channelIds)];
    await assertLinks(
      c.env,
      actor.organizationId,
      monitorIds,
      pageIds,
      channelIds,
    );
    const now = Date.now();
    const id = crypto.randomUUID();
    const db = getDb(c.env.DB);
    await db.insert(maintenanceWindows).values({
      id,
      organizationId: actor.organizationId,
      title: body.title,
      description: body.description,
      timezone: body.timezone,
      startAt: body.startAt,
      endAt: body.endAt,
      recurrence: body.recurrence,
      weekdaysJson: JSON.stringify([...new Set(body.weekdays)].sort()),
      notify: body.notify,
      cancelledAt: null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await replaceLinks(c.env, id, monitorIds, pageIds, channelIds);
    const created = await loadWindow(c.env, actor.organizationId, id);
    const schedule = scheduleFromRow({
      startAt: body.startAt,
      endAt: body.endAt,
      timezone: body.timezone,
      recurrence: body.recurrence,
      weekdaysJson: JSON.stringify(body.weekdays),
      cancelledAt: null,
    });
    if (schedule) {
      await signalStarted(c.env, schedule, {
        id,
        organizationId: actor.organizationId,
        title: body.title,
        description: body.description,
        notify: body.notify,
        channelIds,
        pageIds,
      });
    }
    await audit(
      c.env,
      actor,
      "maintenance.create",
      id,
      null,
      { title: body.title },
      clientIp(c),
    );
    return c.json(created, 201);
  });

  app.get("/api/maintenance/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "maintenance.read");
    return c.json(
      await loadWindow(c.env, actor.organizationId, c.req.param("id")),
    );
  });

  app.patch("/api/maintenance/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "maintenance.write");
    const current = await loadWindow(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    if (current.cancelledAt) {
      throw new ApiError(400, "validation", t("error_maintenance_cancelled"));
    }
    const body = await parseBody(c, maintenanceWriteSchema);
    assertSchedule(body);
    const monitorIds = [...new Set(body.monitorIds)];
    const pageIds = [...new Set(body.pageIds)];
    const channelIds = [...new Set(body.channelIds)];
    await assertLinks(
      c.env,
      actor.organizationId,
      monitorIds,
      pageIds,
      channelIds,
    );
    const scheduleChanged =
      current.startAt !== body.startAt ||
      current.endAt !== body.endAt ||
      current.timezone !== body.timezone ||
      current.recurrence !== body.recurrence ||
      JSON.stringify(current.weekdays) !==
        JSON.stringify([...new Set(body.weekdays)].sort());
    await getDb(c.env.DB)
      .update(maintenanceWindows)
      .set({
        title: body.title,
        description: body.description,
        timezone: body.timezone,
        startAt: body.startAt,
        endAt: body.endAt,
        recurrence: body.recurrence,
        weekdaysJson: JSON.stringify([...new Set(body.weekdays)].sort()),
        notify: body.notify,
        updatedAt: Date.now(),
      })
      .where(eq(maintenanceWindows.id, current.id));
    await replaceLinks(c.env, current.id, monitorIds, pageIds, channelIds);
    if (scheduleChanged) {
      const schedule = scheduleFromRow({
        startAt: body.startAt,
        endAt: body.endAt,
        timezone: body.timezone,
        recurrence: body.recurrence,
        weekdaysJson: JSON.stringify(body.weekdays),
        cancelledAt: null,
      });
      if (schedule) {
        await signalStarted(c.env, schedule, {
          id: current.id,
          organizationId: actor.organizationId,
          title: body.title,
          description: body.description,
          notify: body.notify,
          channelIds,
          pageIds,
        });
      }
    }
    await audit(
      c.env,
      actor,
      "maintenance.update",
      current.id,
      { title: current.title },
      { title: body.title },
      clientIp(c),
    );
    return c.json(await loadWindow(c.env, actor.organizationId, current.id));
  });

  app.post("/api/maintenance/:id/cancel", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "maintenance.write");
    const current = await loadWindow(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    if (!current.cancelledAt) {
      const now = Date.now();
      await getDb(c.env.DB)
        .update(maintenanceWindows)
        .set({ cancelledAt: now, updatedAt: now })
        .where(eq(maintenanceWindows.id, current.id));
      await audit(
        c.env,
        actor,
        "maintenance.cancel",
        current.id,
        null,
        { cancelledAt: now },
        clientIp(c),
      );
    }
    return c.json(await loadWindow(c.env, actor.organizationId, current.id));
  });

  app.delete("/api/maintenance/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "maintenance.write");
    const current = await loadWindow(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    await getDb(c.env.DB)
      .delete(maintenanceWindows)
      .where(eq(maintenanceWindows.id, current.id));
    await audit(
      c.env,
      actor,
      "maintenance.delete",
      current.id,
      { title: current.title },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });
}
