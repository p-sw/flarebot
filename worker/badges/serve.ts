// SPDX-License-Identifier: MIT

import { and, eq, gte } from "drizzle-orm";
import {
  badgeStatusFromRuntime,
  effectiveWindowLabel,
  etagMatches,
  etagOf,
  renderBadge,
  responseColor,
  statusColor,
  uptimeColor,
} from "../../shared/badge";
import {
  type BadgeKind,
  type BadgeQuery,
  canonicalBadgePath,
} from "../../shared/badge-link";
import { t } from "../../shared/copy";
import {
  type DisplayRange,
  resolveWindow,
  summarizeHistory,
  utcDayStart,
} from "../../shared/history";
import { getDb } from "../db/client";
import {
  monitorState,
  monitors,
  statusPageItems,
  statusPages,
  uptimeDaily,
  uptimeHourly,
} from "../db/schema";
import type { AppContext } from "../http";
import { schedulerStub } from "../monitors/sync";
import { historyRetentionDays } from "../retention";

const CACHE_CONTROL = "public, max-age=120";

type BadgeRow = {
  id: string;
  type: string;
  paused: boolean;
  badgesEnabled: boolean;
  shardId: string;
  status: string | null;
};

function unknownBadge(kind: BadgeKind, query: BadgeQuery): string {
  const label =
    query.label ??
    (kind === "status"
      ? t("badge_label_status")
      : kind === "uptime"
        ? t("badge_label_uptime", { window: query.window })
        : t("badge_label_response", { window: query.window }));
  return renderBadge({
    label,
    message: t("badge_value_unknown"),
    color: statusColor("unknown"),
    style: query.style,
  });
}

function statusMessage(
  status: ReturnType<typeof badgeStatusFromRuntime>,
): string {
  switch (status) {
    case "up":
      return t("badge_value_up");
    case "down":
      return t("badge_value_down");
    case "paused":
      return t("badge_value_paused");
    default:
      return t("badge_value_degraded");
  }
}

async function loadRow(env: Env, id: string): Promise<BadgeRow | null> {
  const row = await getDb(env.DB)
    .select({
      id: monitors.id,
      type: monitors.type,
      paused: monitors.paused,
      badgesEnabled: monitors.badgesEnabled,
      shardId: monitors.shardId,
      status: monitorState.status,
    })
    .from(monitors)
    .leftJoin(monitorState, eq(monitorState.monitorId, monitors.id))
    .where(eq(monitors.id, id))
    .get();
  return row ?? null;
}

async function onPublishedPage(env: Env, id: string): Promise<boolean> {
  const row = await getDb(env.DB)
    .select({ id: statusPageItems.id })
    .from(statusPageItems)
    .innerJoin(statusPages, eq(statusPageItems.pageId, statusPages.id))
    .where(
      and(eq(statusPageItems.monitorId, id), eq(statusPages.published, true)),
    )
    .limit(1)
    .get();
  return Boolean(row);
}

async function loadSummary(
  env: Env,
  row: BadgeRow,
  range: DisplayRange,
): Promise<{
  uptime: number | null;
  responseMs: number | null;
  windowLabel: string;
}> {
  const now = Date.now();
  const retentionDays = await historyRetentionDays(env);
  const window = resolveWindow(range, retentionDays, now);
  const db = getDb(env.DB);
  const daily =
    window.bucket === "slot"
      ? []
      : await db
          .select({
            dayStart: uptimeDaily.dayStart,
            okCount: uptimeDaily.okCount,
            failCount: uptimeDaily.failCount,
            latencySum: uptimeDaily.latencySum,
            maintCount: uptimeDaily.maintCount,
          })
          .from(uptimeDaily)
          .where(
            and(
              eq(uptimeDaily.monitorId, row.id),
              gte(uptimeDaily.dayStart, utcDayStart(window.start)),
            ),
          );
  const hourlySince = window.bucket === "day" ? utcDayStart(now) : window.start;
  const hourly = await db
    .select({
      hourStart: uptimeHourly.hourStart,
      okCount: uptimeHourly.okCount,
      failCount: uptimeHourly.failCount,
      latencySum: uptimeHourly.latencySum,
      maintCount: uptimeHourly.maintCount,
    })
    .from(uptimeHourly)
    .where(
      and(
        eq(uptimeHourly.monitorId, row.id),
        gte(uptimeHourly.hourStart, hourlySince),
      ),
    );
  const live = await schedulerStub(env, row.shardId)
    .getOne(row.id)
    .catch(() => null);
  const summary = summarizeHistory({
    window,
    now,
    daily: daily.map((item) => ({
      start: item.dayStart,
      ok: item.okCount,
      fail: item.failCount,
      sum: item.latencySum,
      maint: item.maintCount,
    })),
    hourly: hourly.map((item) => ({
      start: item.hourStart,
      ok: item.okCount,
      fail: item.failCount,
      sum: item.latencySum,
      maint: item.maintCount,
    })),
    live: live?.rollup
      ? {
          start: live.rollup.hourStart,
          ok: live.rollup.ok,
          fail: live.rollup.fail,
          sum: live.rollup.sum,
          maint: live.rollup.maint ?? 0,
        }
      : null,
  });
  return {
    uptime: summary.uptime,
    responseMs: summary.responseMs,
    windowLabel: effectiveWindowLabel(window),
  };
}

export async function badgeSvg(
  env: Env,
  id: string | null,
  kind: BadgeKind | null,
  query: BadgeQuery,
): Promise<string> {
  const resolved = kind ?? "status";
  if (!id || !kind) return unknownBadge(resolved, query);
  const row = await loadRow(env, id);
  if (!row) return unknownBadge(resolved, query);
  const allowed = row.badgesEnabled || (await onPublishedPage(env, id));
  if (!allowed) return unknownBadge(resolved, query);
  if (resolved === "status") {
    const status = badgeStatusFromRuntime(row.paused, row.status);
    return renderBadge({
      label: query.label ?? t("badge_label_status"),
      message: statusMessage(status),
      color: statusColor(status),
      style: query.style,
    });
  }
  const summary = await loadSummary(env, row, query.window);
  const label =
    query.label ??
    (resolved === "uptime"
      ? t("badge_label_uptime", { window: summary.windowLabel })
      : t(
          row.type === "http"
            ? "badge_label_response_ttfb"
            : "badge_label_response",
          { window: summary.windowLabel },
        ));
  if (resolved === "uptime") {
    return renderBadge({
      label,
      message:
        summary.uptime == null
          ? t("badge_value_empty")
          : t("badge_value_uptime", { value: summary.uptime }),
      color: uptimeColor(summary.uptime),
      style: query.style,
    });
  }
  return renderBadge({
    label,
    message:
      summary.responseMs == null
        ? t("badge_value_empty")
        : t("badge_value_response", { value: summary.responseMs }),
    color: responseColor(summary.responseMs),
    style: query.style,
  });
}

function cacheKey(
  origin: string,
  id: string,
  kind: BadgeKind | null,
  query: BadgeQuery,
): Request {
  const path = canonicalBadgePath(id, kind ?? "status", query);
  const suffix = kind ? path : path.replace("/status.svg", "/invalid.svg");
  return new Request(`${origin}${suffix}`, { method: "GET" });
}

function svgHeaders(etag: string, cache: boolean): Headers {
  const headers = new Headers({
    "content-type": "image/svg+xml; charset=utf-8",
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
  });
  if (cache) headers.set("cache-control", CACHE_CONTROL);
  else headers.set("cache-control", "private, no-store");
  return headers;
}

export async function publicBadgeResponse(
  c: AppContext,
  id: string | null,
  kind: BadgeKind | null,
  query: BadgeQuery,
): Promise<Response> {
  const origin = new URL(c.req.url).origin;
  const key = cacheKey(origin, id ?? "none", kind, query);
  const cached = await caches.default.match(key).catch(() => undefined);
  if (cached) {
    const etag = cached.headers.get("etag") ?? "";
    if (etag && etagMatches(c.req.header("if-none-match") ?? null, etag)) {
      return new Response(null, { status: 304, headers: cached.headers });
    }
    if (c.req.method === "HEAD") {
      return new Response(null, { status: 200, headers: cached.headers });
    }
    return new Response(cached.body, { status: 200, headers: cached.headers });
  }
  const body = await badgeSvg(c.env, id, kind, query);
  const etag = etagOf(body);
  const headers = svgHeaders(etag, true);
  const stored = new Response(body, { status: 200, headers });
  const put = caches.default.put(key, stored.clone()).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    void put;
  }
  if (etagMatches(c.req.header("if-none-match") ?? null, etag)) {
    return new Response(null, { status: 304, headers });
  }
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return stored;
}

export async function previewBadgeResponse(
  c: AppContext,
  id: string,
  kind: BadgeKind,
  query: BadgeQuery,
): Promise<Response> {
  const body = await badgeSvg(c.env, id, kind, query);
  const headers = svgHeaders(etagOf(body), false);
  if (c.req.method === "HEAD")
    return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}
