// SPDX-License-Identifier: MIT

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  type Impact,
  type IncidentStatus,
  isImpact,
  isIncidentStatus,
  latestByPostedAt,
  worstImpact,
} from "../../shared/impact";
import {
  classifySchedule,
  nextOccurrences,
  occurrenceContaining,
} from "../../shared/recurrence";
import { getDb } from "../db/client";
import {
  incidentMonitors,
  incidentPages,
  incidents,
  incidentUpdates,
  maintenanceMonitors,
  maintenancePages,
  maintenanceWindows,
  monitors,
  statusPages,
} from "../db/schema";
import { scheduleFromRow } from "../maintenance";

export type PublicIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  updatedAt: number;
  impact: Impact | null;
  message: string;
  monitors: { name: string; impact: Impact }[];
};

export type PublicIncidentDetail = PublicIncident & {
  updates: {
    id: string;
    status: IncidentStatus;
    body: string;
    postedAt: number;
  }[];
};

export type PageAnnouncements = {
  incidents: PublicIncident[];
  history: { id: string; title: string; resolvedAt: number }[];
  maintenance: {
    id: string;
    title: string;
    description: string;
    start: number;
    end: number;
    state: "active" | "upcoming";
    monitors: string[];
  }[];
  impactByMonitor: Map<string, Impact>;
  maintenanceMonitors: Set<string>;
};

export async function loadPageAnnouncements(
  env: Env,
  pageId: string,
  monitorIds: readonly string[],
  names: Map<string, string>,
  now: number,
): Promise<PageAnnouncements> {
  const db = getDb(env.DB);
  const onPage =
    monitorIds.length > 0 ? new Set(monitorIds) : new Set<string>();
  const openLinks = await db
    .select({
      id: incidents.id,
      title: incidents.title,
      updatedAt: incidents.updatedAt,
    })
    .from(incidents)
    .innerJoin(incidentPages, eq(incidentPages.incidentId, incidents.id))
    .where(and(eq(incidentPages.pageId, pageId), isNull(incidents.resolvedAt)))
    .orderBy(desc(incidents.updatedAt));
  const openIds = openLinks.map((row) => row.id);
  const links = openIds.length
    ? await db
        .select()
        .from(incidentMonitors)
        .where(inArray(incidentMonitors.incidentId, openIds))
    : [];
  const updates = openIds.length
    ? await db
        .select()
        .from(incidentUpdates)
        .where(inArray(incidentUpdates.incidentId, openIds))
    : [];
  const impactByMonitor = new Map<string, Impact>();
  const publicIncidents: PublicIncident[] = [];
  for (const incident of openLinks) {
    const monitorsForIncident = links.filter(
      (link) => link.incidentId === incident.id && isImpact(link.impact),
    );
    const visible = monitorsForIncident.filter((link) =>
      onPage.has(link.monitorId),
    );
    for (const link of visible) {
      if (!isImpact(link.impact)) continue;
      const current = impactByMonitor.get(link.monitorId);
      const next = worstImpact(
        [current, link.impact].filter((item): item is Impact => item != null),
      );
      if (next) impactByMonitor.set(link.monitorId, next);
    }
    const latest = latestByPostedAt(
      updates.filter((update) => update.incidentId === incident.id),
    );
    const status =
      latest && isIncidentStatus(latest.status)
        ? latest.status
        : "investigating";
    publicIncidents.push({
      id: incident.id,
      title: incident.title,
      status,
      updatedAt: incident.updatedAt,
      impact: worstImpact(
        visible
          .map((link) => link.impact)
          .filter((impact): impact is Impact => isImpact(impact)),
      ),
      message: latest?.body ?? "",
      monitors: visible.map((link) => ({
        name: names.get(link.monitorId) ?? "",
        impact: link.impact as Impact,
      })),
    });
  }
  const historyRows = await db
    .select({
      id: incidents.id,
      title: incidents.title,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .innerJoin(incidentPages, eq(incidentPages.incidentId, incidents.id))
    .where(
      and(eq(incidentPages.pageId, pageId), isNotNull(incidents.resolvedAt)),
    )
    .orderBy(desc(incidents.resolvedAt))
    .limit(20);
  const windowLinks = await db
    .select({
      id: maintenanceWindows.id,
      title: maintenanceWindows.title,
      description: maintenanceWindows.description,
      timezone: maintenanceWindows.timezone,
      startAt: maintenanceWindows.startAt,
      endAt: maintenanceWindows.endAt,
      recurrence: maintenanceWindows.recurrence,
      weekdaysJson: maintenanceWindows.weekdaysJson,
      cancelledAt: maintenanceWindows.cancelledAt,
    })
    .from(maintenanceWindows)
    .innerJoin(
      maintenancePages,
      eq(maintenancePages.maintenanceId, maintenanceWindows.id),
    )
    .where(eq(maintenancePages.pageId, pageId));
  const windowIds = windowLinks.map((row) => row.id);
  const windowMonitors = windowIds.length
    ? await db
        .select({
          maintenanceId: maintenanceMonitors.maintenanceId,
          monitorId: maintenanceMonitors.monitorId,
          name: monitors.name,
        })
        .from(maintenanceMonitors)
        .innerJoin(monitors, eq(monitors.id, maintenanceMonitors.monitorId))
        .where(inArray(maintenanceMonitors.maintenanceId, windowIds))
    : [];
  const maintenanceMonitorsOnPage = new Set<string>();
  const maintenance: PageAnnouncements["maintenance"] = [];
  for (const row of windowLinks) {
    const schedule = scheduleFromRow(row);
    if (!schedule) continue;
    const state = classifySchedule(schedule, now);
    if (state === "past") continue;
    const occurrence =
      occurrenceContaining(schedule, now) ??
      nextOccurrences(schedule, now, 1)[0];
    if (!occurrence) continue;
    const named = windowMonitors.filter(
      (link) => link.maintenanceId === row.id && onPage.has(link.monitorId),
    );
    if (state === "active") {
      for (const link of named) maintenanceMonitorsOnPage.add(link.monitorId);
    }
    maintenance.push({
      id: row.id,
      title: row.title,
      description: row.description,
      start: occurrence.start,
      end: occurrence.end,
      state,
      monitors: named.map((link) => link.name),
    });
  }
  maintenance.sort((left, right) => left.start - right.start);
  return {
    incidents: publicIncidents,
    history: historyRows.flatMap((row) =>
      row.resolvedAt == null
        ? []
        : [{ id: row.id, title: row.title, resolvedAt: row.resolvedAt }],
    ),
    maintenance,
    impactByMonitor,
    maintenanceMonitors: maintenanceMonitorsOnPage,
  };
}

export async function loadPublicIncident(
  env: Env,
  slug: string,
  incidentId: string,
): Promise<{ slug: string; incident: PublicIncidentDetail } | null> {
  const db = getDb(env.DB);
  const page = await db
    .select()
    .from(statusPages)
    .where(eq(statusPages.slug, slug))
    .get();
  if (!page?.published) return null;
  const incident = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .get();
  if (!incident || incident.organizationId !== page.organizationId) return null;
  const linked = await db
    .select()
    .from(incidentPages)
    .where(
      and(
        eq(incidentPages.incidentId, incident.id),
        eq(incidentPages.pageId, page.id),
      ),
    )
    .get();
  if (!linked) return null;
  const [links, updates, owned] = await Promise.all([
    db
      .select()
      .from(incidentMonitors)
      .where(eq(incidentMonitors.incidentId, incident.id)),
    db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, incident.id)),
    db
      .select()
      .from(monitors)
      .where(eq(monitors.organizationId, page.organizationId)),
  ]);
  const names = new Map(owned.map((row) => [row.id, row.name]));
  const ordered = [...updates].sort(
    (left, right) =>
      left.postedAt - right.postedAt || left.createdAt - right.createdAt,
  );
  const latest = latestByPostedAt(ordered);
  return {
    slug: page.slug,
    incident: {
      id: incident.id,
      title: incident.title,
      status:
        latest && isIncidentStatus(latest.status)
          ? latest.status
          : "investigating",
      updatedAt: incident.updatedAt,
      impact: worstImpact(
        links
          .map((link) => link.impact)
          .filter((impact): impact is Impact => isImpact(impact)),
      ),
      message: latest?.body ?? "",
      monitors: links.flatMap((link) =>
        isImpact(link.impact)
          ? [{ name: names.get(link.monitorId) ?? "", impact: link.impact }]
          : [],
      ),
      updates: ordered.flatMap((update) =>
        isIncidentStatus(update.status)
          ? [
              {
                id: update.id,
                status: update.status,
                body: update.body,
                postedAt: update.postedAt,
              },
            ]
          : [],
      ),
    },
  };
}
