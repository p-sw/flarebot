// SPDX-License-Identifier: MIT

import {
  DISPLAY_RANGES,
  type DisplayRange,
  parseDisplayRange,
} from "./history";

export const BADGE_KINDS = ["status", "uptime", "response"] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export const BADGE_STYLES = ["flat", "flat-square", "for-the-badge"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];

export const BADGE_WINDOWS = DISPLAY_RANGES;
export type BadgeWindow = DisplayRange;

export const BADGE_LABEL_MAX = 48;

const MONITOR_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BadgeQuery = {
  style: BadgeStyle;
  window: BadgeWindow;
  label: string | null;
};

export function isBadgeMonitorId(value: string): boolean {
  return MONITOR_ID.test(value);
}

export function normalizeBadgeMonitorId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return isBadgeMonitorId(id) ? id : null;
}

export function parseBadgeKind(file: string): BadgeKind | null {
  const name = file.endsWith(".svg") ? file.slice(0, -4) : file;
  if ((BADGE_KINDS as readonly string[]).includes(name))
    return name as BadgeKind;
  return null;
}

export function parseBadgeStyle(value: string | null | undefined): BadgeStyle {
  if (value && (BADGE_STYLES as readonly string[]).includes(value))
    return value as BadgeStyle;
  return "flat";
}

function stripControls(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) {
      result += " ";
      continue;
    }
    if (code <= 31 || code === 127) continue;
    result += char;
  }
  return result;
}

export function sanitizeBadgeLabel(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const cleaned = stripControls(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const chars = [...cleaned];
  if (chars.length <= BADGE_LABEL_MAX) return cleaned;
  return chars.slice(0, BADGE_LABEL_MAX).join("");
}

export function badgeQueryFrom(search: URLSearchParams): BadgeQuery {
  return {
    style: parseBadgeStyle(search.get("style")),
    window: parseDisplayRange(search.get("window")),
    label: sanitizeBadgeLabel(search.get("label")),
  };
}

export function canonicalBadgePath(
  id: string,
  kind: BadgeKind,
  query: BadgeQuery,
): string {
  const params = new URLSearchParams();
  if (query.style !== "flat") params.set("style", query.style);
  if (kind !== "status" && query.window !== "24h")
    params.set("window", query.window);
  if (query.label) params.set("label", query.label);
  const qs = params.toString();
  return `/badge/${id}/${kind}.svg${qs ? `?${qs}` : ""}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function badgePageUrl(
  origin: string,
  pages: { published: boolean; serveAtRoot: boolean; slug: string }[],
  imageUrl: string,
): string {
  const published = pages.filter((page) => page.published);
  const root = published.find((page) => page.serveAtRoot);
  if (root) return `${origin}/`;
  const page = published[0];
  if (page) return `${origin}/s/${page.slug}`;
  return imageUrl;
}

export function badgeSnippets(input: {
  imageUrl: string;
  pageUrl: string;
  alt: string;
}): { url: string; markdown: string; html: string } {
  const alt = input.alt.replaceAll("[", "").replaceAll("]", "");
  return {
    url: input.imageUrl,
    markdown: `[![${alt}](${input.imageUrl})](${input.pageUrl})`,
    html: `<img alt="${escapeHtml(input.alt)}" src="${escapeHtml(input.imageUrl)}">`,
  };
}
