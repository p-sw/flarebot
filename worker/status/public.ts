// SPDX-License-Identifier: MIT

import { and, eq, gte, inArray } from "drizzle-orm";
import { t, textLang } from "../../shared/copy";
import {
  type CountRow,
  type DisplayRange,
  parseDisplayRange,
  resolveWindow,
  summarizeHistory,
  utcDayStart,
} from "../../shared/history";
import {
  type Impact,
  type IncidentStatus,
  pageOverall,
  presentStatus,
} from "../../shared/impact";
import { statusItemLabel } from "../../shared/status-layout";
import { getDb } from "../db/client";
import {
  monitorState,
  monitors,
  statusPageItems,
  statusPages,
  uptimeDaily,
  uptimeHourly,
} from "../db/schema";
import { schedulerStub } from "../monitors/sync";
import { historyRetentionDays } from "../retention";
import { loadPageAnnouncements } from "./announcements";

export type PublicStatus = {
  slug: string;
  title: string;
  description: string;
  footer: string;
  banner: string;
  logoUrl: string | null;
  accent: string | null;
  serveAtRoot: boolean;
  displayRange: DisplayRange;
  bucket: "hour" | "day";
  barCount: number;
  clamped: boolean;
  retentionDays: number;
  overall:
    | "operational"
    | "degraded"
    | "outage"
    | "empty"
    | "paused"
    | "maintenance";
  incidents: {
    id: string;
    title: string;
    status: IncidentStatus;
    updatedAt: number;
    impact: Impact | null;
    message: string;
    monitors: { name: string; impact: Impact }[];
  }[];
  history: {
    id: string;
    title: string;
    resolvedAt: number;
  }[];
  maintenance: {
    id: string;
    title: string;
    description: string;
    start: number;
    end: number;
    state: "active" | "upcoming";
    monitors: string[];
  }[];
  groups: {
    name: string;
    items: {
      id: string;
      name: string;
      status: string;
      uptime: number | null;
      responseMs: number | null;
      maint: number;
      bars: {
        start: number;
        uptime: number | null;
        responseMs: number | null;
        state: "empty" | "up" | "degraded" | "down" | "maintenance";
        maint: number;
      }[];
    }[];
  }[];
};

export async function loadPublicStatus(
  env: Env,
  slug: string,
): Promise<PublicStatus | null> {
  const db = getDb(env.DB);
  const page = await db
    .select()
    .from(statusPages)
    .where(eq(statusPages.slug, slug))
    .get();
  if (!page?.published) return null;
  const items = await db
    .select()
    .from(statusPageItems)
    .where(eq(statusPageItems.pageId, page.id));
  items.sort((a, b) => a.position - b.position);
  const nowMs = Date.now();
  const retentionDays = await historyRetentionDays(env);
  const window = resolveWindow(
    parseDisplayRange(page.displayRange),
    retentionDays,
    nowMs,
  );
  const ids = items.map((item) => item.monitorId);
  const daily =
    ids.length && window.bucket === "day"
      ? await db
          .select()
          .from(uptimeDaily)
          .where(
            and(
              gte(uptimeDaily.dayStart, window.start),
              inArray(uptimeDaily.monitorId, ids),
            ),
          )
      : [];
  const hourlySince =
    window.bucket === "hour" ? window.start : utcDayStart(nowMs);
  const hourly = ids.length
    ? await db
        .select()
        .from(uptimeHourly)
        .where(
          and(
            gte(uptimeHourly.hourStart, hourlySince),
            inArray(uptimeHourly.monitorId, ids),
          ),
        )
    : [];
  const owned = ids.length
    ? await db.select().from(monitors).where(inArray(monitors.id, ids))
    : [];
  const live = new Map<string, CountRow>();
  const shardIds = [...new Set(owned.map((row) => row.shardId))];
  await Promise.all(
    shardIds.map(async (shardId) => {
      const rows = await schedulerStub(env, shardId)
        .getAll()
        .catch(() => []);
      for (const row of rows) {
        if (!row.rollup || row.rollup.hourStart < window.start) continue;
        const current = live.get(row.id) ?? {
          start: row.rollup.hourStart,
          ok: 0,
          fail: 0,
          sum: 0,
          maint: 0,
        };
        if (row.rollup.hourStart !== current.start) continue;
        current.ok += row.rollup.ok;
        current.fail += row.rollup.fail;
        current.sum += row.rollup.sum;
        current.maint = (current.maint ?? 0) + (row.rollup.maint ?? 0);
        live.set(row.id, current);
      }
    }),
  );
  const states = items.length ? await db.select().from(monitorState) : [];
  const stateById = new Map(states.map((row) => [row.monitorId, row.status]));
  const pausedById = new Map(owned.map((row) => [row.id, row.paused]));
  const nameById = new Map(owned.map((row) => [row.id, row.name]));
  const announcements = await loadPageAnnouncements(
    env,
    page.id,
    ids,
    nameById,
    nowMs,
  );
  const groups = new Map<
    string,
    { name: string; items: PublicStatus["groups"][number]["items"] }
  >();
  for (const item of items) {
    const name =
      statusItemLabel(item.displayName, nameById.get(item.monitorId) ?? "") ||
      t("monitor_fallback_name");
    const groupKey = item.groupName;
    const groupName = item.groupName.trim();
    const summary = summarizeHistory({
      window,
      now: nowMs,
      daily: daily
        .filter((row) => row.monitorId === item.monitorId)
        .map((row) => ({
          start: row.dayStart,
          ok: row.okCount,
          fail: row.failCount,
          sum: row.latencySum,
          maint: row.maintCount,
        })),
      hourly: hourly
        .filter((row) => row.monitorId === item.monitorId)
        .map((row) => ({
          start: row.hourStart,
          ok: row.okCount,
          fail: row.failCount,
          sum: row.latencySum,
          maint: row.maintCount,
        })),
      live: live.get(item.monitorId) ?? null,
    });
    const bucket = groups.get(groupKey) ?? { name: groupName, items: [] };
    if (!bucket.name && groupName) bucket.name = groupName;
    bucket.items.push({
      id: item.id,
      name,
      status: presentStatus({
        paused: pausedById.get(item.monitorId) ?? false,
        runtime: stateById.get(item.monitorId),
        impact: announcements.impactByMonitor.get(item.monitorId) ?? null,
        maintenance: announcements.maintenanceMonitors.has(item.monitorId),
      }),
      uptime: summary.uptime,
      responseMs: summary.responseMs,
      maint: summary.maint,
      bars: summary.bars,
    });
    groups.set(groupKey, bucket);
  }
  const flat = [...groups.values()].flatMap((group) => group.items);
  const overall = pageOverall(flat.map((item) => item.status));
  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    footer: page.footer,
    banner: page.banner,
    logoUrl: page.logoUrl,
    accent: page.accent,
    serveAtRoot: page.serveAtRoot,
    displayRange: window.configured,
    bucket: window.bucket,
    barCount: window.bars,
    clamped: window.clamped,
    retentionDays: window.retentionDays,
    overall,
    incidents: announcements.incidents,
    history: announcements.history,
    maintenance: announcements.maintenance,
    groups: [...groups.values()].map((group) => ({
      name: group.name,
      items: group.items,
    })),
  };
}

export async function loadRootPublicStatus(
  env: Env,
): Promise<PublicStatus | null> {
  const page = await getDb(env.DB)
    .select({ slug: statusPages.slug })
    .from(statusPages)
    .where(
      and(eq(statusPages.serveAtRoot, true), eq(statusPages.published, true)),
    )
    .get();
  if (!page) return null;
  return loadPublicStatus(env, page.slug);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function injectDocument(
  html: string,
  page: PublicStatus,
  canonical: string,
): string {
  const title = `<title>${escapeHtml(page.title)}</title>`;
  const meta = [
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
  ].join("");
  let next = html;
  const hadTitle = /<title>[\s\S]*?<\/title>/.test(next);
  if (hadTitle) next = next.replace(/<title>[\s\S]*?<\/title>/, title);
  const head = `${hadTitle ? "" : title}${meta}`;
  next = next.includes("<!--flarebot-meta-->")
    ? next.replace("<!--flarebot-meta-->", head)
    : next.replace("</head>", `${head}</head>`);
  next = next.replace(/<html\b[^>]*>/, `<html lang="${escapeHtml(textLang)}">`);
  return next;
}

export async function statusDocument(
  env: Env,
  request: Request,
  page: PublicStatus,
): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  let html =
    '<!doctype html><html><head><!--flarebot-meta--></head><body><div id="root"></div></body></html>';
  try {
    const asset = await env.ASSETS.fetch(new Request(url, request));
    if (asset.ok) {
      const text = await asset.text();
      if (text.includes("<html")) html = text;
    }
  } catch {
    // The SPA shell is optional in unit-style worker tests.
  }
  const origin = new URL(request.url).origin;
  const canonical = page.serveAtRoot
    ? `${origin}/`
    : `${origin}/s/${page.slug}`;
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
  });
  return new Response(injectDocument(html, page, canonical), { headers });
}

export async function publishedPageExists(
  env: Env,
  slug: string,
): Promise<boolean> {
  const page = await getDb(env.DB)
    .select({ id: statusPages.id })
    .from(statusPages)
    .where(and(eq(statusPages.slug, slug), eq(statusPages.published, true)))
    .get();
  return Boolean(page);
}
