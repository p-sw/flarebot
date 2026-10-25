// SPDX-License-Identifier: MIT

import { and, eq, gte, inArray } from "drizzle-orm";
import { t, textLang } from "../../shared/copy";
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

export type PublicStatus = {
  slug: string;
  title: string;
  description: string;
  footer: string;
  banner: string;
  logoUrl: string | null;
  accent: string | null;
  serveAtRoot: boolean;
  overall: "operational" | "degraded" | "outage" | "empty";
  groups: {
    name: string;
    items: {
      id: string;
      name: string;
      status: string;
      uptime90: number | null;
      bars: { day: number; uptime: number | null }[];
    }[];
  }[];
};

function percent(ok: number, fail: number): number | null {
  const total = ok + fail;
  if (total === 0) return null;
  return Math.round((ok / total) * 1000) / 10;
}

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
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const since = today - 89 * 86_400_000;
  const ids = items.map((item) => item.monitorId);
  const daily = ids.length
    ? await db
        .select()
        .from(uptimeDaily)
        .where(
          and(
            gte(uptimeDaily.dayStart, since),
            inArray(uptimeDaily.monitorId, ids),
          ),
        )
    : [];
  const hourly = ids.length
    ? await db
        .select()
        .from(uptimeHourly)
        .where(
          and(
            gte(uptimeHourly.hourStart, today),
            inArray(uptimeHourly.monitorId, ids),
          ),
        )
    : [];
  const owned = ids.length
    ? await db.select().from(monitors).where(inArray(monitors.id, ids))
    : [];
  const live = new Map<string, { ok: number; fail: number }>();
  const shardIds = [...new Set(owned.map((row) => row.shardId))];
  await Promise.all(
    shardIds.map(async (shardId) => {
      const rows = await schedulerStub(env, shardId)
        .getAll()
        .catch(() => []);
      for (const row of rows) {
        if (!row.rollup || row.rollup.hourStart < today) continue;
        const current = live.get(row.id) ?? { ok: 0, fail: 0 };
        current.ok += row.rollup.ok;
        current.fail += row.rollup.fail;
        live.set(row.id, current);
      }
    }),
  );
  const states = items.length ? await db.select().from(monitorState) : [];
  const stateById = new Map(states.map((row) => [row.monitorId, row.status]));
  const groups = new Map<string, PublicStatus["groups"][number]["items"]>();
  for (const item of items) {
    const name =
      item.displayName || item.groupName || t("monitor_fallback_name");
    const groupName = item.groupName || "";
    const rows = daily.filter((row) => row.monitorId === item.monitorId);
    const todayHours = hourly.filter((row) => row.monitorId === item.monitorId);
    const pending = live.get(item.monitorId) ?? { ok: 0, fail: 0 };
    const bars = Array.from({ length: 90 }, (_, index) => {
      const day = since + index * 86_400_000;
      const match = rows.find((row) => row.dayStart === day);
      const ok = match?.okCount ?? 0;
      const fail = match?.failCount ?? 0;
      if (day === today) {
        return {
          day,
          uptime: percent(
            ok +
              todayHours.reduce((sum, row) => sum + row.okCount, 0) +
              pending.ok,
            fail +
              todayHours.reduce((sum, row) => sum + row.failCount, 0) +
              pending.fail,
          ),
        };
      }
      return {
        day,
        uptime: match ? percent(match.okCount, match.failCount) : null,
      };
    });
    const ok =
      rows.reduce((sum, row) => sum + row.okCount, 0) +
      todayHours.reduce((sum, row) => sum + row.okCount, 0) +
      pending.ok;
    const fail =
      rows.reduce((sum, row) => sum + row.failCount, 0) +
      todayHours.reduce((sum, row) => sum + row.failCount, 0) +
      pending.fail;
    const list = groups.get(groupName) ?? [];
    list.push({
      id: item.id,
      name,
      status: stateById.get(item.monitorId) ?? "unknown",
      uptime90: percent(ok, fail),
      bars,
    });
    groups.set(groupName, list);
  }
  const flat = [...groups.values()].flat();
  const overall: PublicStatus["overall"] =
    flat.length === 0
      ? "empty"
      : flat.some((item) => item.status === "down")
        ? flat.every((item) => item.status === "down")
          ? "outage"
          : "degraded"
        : "operational";
  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    footer: page.footer,
    banner: page.banner,
    logoUrl: page.logoUrl,
    accent: page.accent,
    serveAtRoot: page.serveAtRoot,
    overall,
    groups: [...groups.entries()].map(([name, groupItems]) => ({
      name,
      items: groupItems,
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
