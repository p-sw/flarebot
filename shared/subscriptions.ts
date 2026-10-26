// SPDX-License-Identifier: MIT

import { isBlockedHost } from "./schemas";

/**
 * Free-plan budget for visitor delivery. The Worker already runs a cron
 * every five minutes (`288` runs/day). That cron is shared with shard
 * alarms, the announcement outbox (8 sends), daily rollups, and retention.
 *
 * Subscriptions add two small steps on the same cron:
 * - Fan-out inserts at most {@link SUBSCRIPTION_FANOUT_BATCH} delivery rows.
 *   That is D1 only (no subrequest).
 * - Drain sends at most {@link SUBSCRIPTION_DRAIN_BATCH} of those rows.
 *   A webhook is one fetch and does not follow redirects. Email is one
 *   outbox insert, plus a single Mailer kick for the whole batch.
 *
 * Same-day ceiling for one event, when nothing else is draining:
 * `6 * 288 = 1,728` subscriber deliveries. A larger list continues on
 * later days. Several events share the six-per-run drain, so the realistic
 * per-event count is lower when incidents and maintenance overlap.
 *
 * Writes: one insert and one later update per delivery. A full day at the
 * cap is about `1,728 * 2 = 3,456` D1 writes, inside the 100,000/day limit.
 * Confirmation mail is one outbox row on the subscribe request, not on the
 * cron. Subscribe-time DNS checks are also on that request, not the cron.
 */
export const SUBSCRIPTION_FANOUT_BATCH = 12;
export const SUBSCRIPTION_DRAIN_BATCH = 6;
export const SUBSCRIPTION_WEBHOOK_FAILURES = 5;
export const SUBSCRIPTION_PENDING_CAP = 100;
export const SUBSCRIPTION_IP_LIMIT = 8;
export const SUBSCRIPTION_ADDRESS_LIMIT = 4;
export const SUBSCRIPTION_RATE_WINDOW_MS = 60 * 60 * 1000;
export const SUBSCRIPTION_CONFIRM_MS = 48 * 60 * 60 * 1000;
export const FEED_CACHE_SECONDS = 60;
export const FEED_ITEM_CAP = 40;
export const CRON_RUNS_PER_DAY = 288;

export const FREE_PLAN_SUBSCRIPTION = {
  runsPerDay: CRON_RUNS_PER_DAY,
  drainPerRun: SUBSCRIPTION_DRAIN_BATCH,
  deliveriesPerDay: CRON_RUNS_PER_DAY * SUBSCRIPTION_DRAIN_BATCH,
  fanoutPerRun: SUBSCRIPTION_FANOUT_BATCH,
  webhookSubrequestsPerRun: SUBSCRIPTION_DRAIN_BATCH,
  mailKicksPerRun: 1,
  announcementDrainSubrequests: 8,
  subrequestBudget: 50,
  d1WritesPerFullDay: CRON_RUNS_PER_DAY * SUBSCRIPTION_DRAIN_BATCH * 2,
} as const;

const BLOCKED_HOSTNAME =
  /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

export type WebhookUrlIssue = "scheme" | "http" | "private" | "credentials";

export function webhookUrlIssue(
  raw: string,
  allowHttp: boolean,
):
  | { ok: true; href: string; host: string }
  | { ok: false; issue: WebhookUrlIssue } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, issue: "scheme" };
  }
  if (url.username || url.password) return { ok: false, issue: "credentials" };
  if (url.protocol === "http:") {
    if (!allowHttp) return { ok: false, issue: "http" };
  } else if (url.protocol !== "https:") {
    return { ok: false, issue: "scheme" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || isNonPublicHost(host)) return { ok: false, issue: "private" };
  url.hash = "";
  url.hostname = host;
  return { ok: true, href: url.href, host };
}

export function isNonPublicHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!normalized) return true;
  if (BLOCKED_HOSTNAME.test(normalized) || isBlockedHost(normalized))
    return true;
  if (/^\d+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized))
    return true;
  if (isNonPublicIp(normalized)) return true;
  return false;
}

export function isNonPublicIp(raw: string): boolean {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const mapped = host.startsWith("::ffff:")
    ? host.slice("::ffff:".length)
    : host;
  const v4 = ipv4ToInt(mapped);
  if (v4 !== null) return isNonPublicV4(v4);
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  const head = host.split(":").find((part) => part.length > 0) ?? "";
  if (/^fe[89ab]/.test(head)) return true;
  if (/^f[cd]/.test(head)) return true;
  if (/^ff/.test(head)) return true;
  return false;
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isNonPublicV4(value: number): boolean {
  const a = (value >>> 24) & 255;
  const b = (value >>> 16) & 255;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

export function subscriberWantsEvent(
  followAll: boolean,
  monitorIds: readonly string[],
  eventMonitorIds: readonly string[],
): boolean {
  if (followAll) return true;
  if (eventMonitorIds.length === 0) return false;
  const wanted = new Set(monitorIds);
  return eventMonitorIds.some((id) => wanted.has(id));
}

export function rateBucket(
  kind: "ip" | "addr",
  hash: string,
  now: number,
): { bucket: string; windowStart: number } {
  const windowStart =
    Math.floor(now / SUBSCRIPTION_RATE_WINDOW_MS) * SUBSCRIPTION_RATE_WINDOW_MS;
  return { bucket: `${kind}:${hash}:${windowStart}`, windowStart };
}

export type FeedEntry = {
  id: string;
  title: string;
  summary: string;
  href: string | null;
  occurredAt: number;
};

export function renderRss(input: {
  title: string;
  description: string;
  pageUrl: string;
  selfUrl: string;
  items: readonly FeedEntry[];
}): string {
  const items = input.items
    .map((item) => {
      const link = item.href
        ? absoluteUrl(input.pageUrl, item.href)
        : input.pageUrl;
      return [
        "<item>",
        `<title>${xmlEscape(item.title)}</title>`,
        `<link>${xmlEscape(link)}</link>`,
        `<guid isPermaLink="false">${xmlEscape(item.id)}</guid>`,
        `<pubDate>${xmlEscape(new Date(item.occurredAt).toUTCString())}</pubDate>`,
        `<description>${xmlEscape(item.summary)}</description>`,
        "</item>",
      ].join("");
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${xmlEscape(input.title)}</title>`,
    `<link>${xmlEscape(input.pageUrl)}</link>`,
    `<description>${xmlEscape(input.description)}</description>`,
    `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="self" type="application/rss+xml" href="${xmlEscape(input.selfUrl)}"/>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");
}

export function renderAtom(input: {
  title: string;
  pageUrl: string;
  selfUrl: string;
  items: readonly FeedEntry[];
}): string {
  const updated = input.items[0]?.occurredAt ?? Date.now();
  const entries = input.items
    .map((item) => {
      const link = item.href
        ? absoluteUrl(input.pageUrl, item.href)
        : input.pageUrl;
      return [
        "<entry>",
        `<title>${xmlEscape(item.title)}</title>`,
        `<id>urn:flarebot:event:${xmlEscape(item.id)}</id>`,
        `<updated>${xmlEscape(new Date(item.occurredAt).toISOString())}</updated>`,
        `<link rel="alternate" href="${xmlEscape(link)}"/>`,
        `<summary>${xmlEscape(item.summary)}</summary>`,
        "</entry>",
      ].join("");
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${xmlEscape(input.title)}</title>`,
    `<id>${xmlEscape(input.pageUrl)}</id>`,
    `<updated>${xmlEscape(new Date(updated).toISOString())}</updated>`,
    `<link rel="alternate" href="${xmlEscape(input.pageUrl)}"/>`,
    `<link rel="self" href="${xmlEscape(input.selfUrl)}"/>`,
    entries,
    "</feed>",
  ].join("");
}

export function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

function absoluteUrl(pageUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return pageUrl;
  }
}

export async function signBody(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`),
    ),
  );
  return [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseMonitorIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
