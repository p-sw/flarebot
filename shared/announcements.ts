// SPDX-License-Identifier: MIT

/**
 * Announcement events are the seam between status changes and delivery.
 *
 * Incident and maintenance code calls `publishAnnouncement` in
 * `worker/announce/publish.ts`. That function stores one row in
 * `announcement_events` and, when channel ids are passed, one
 * `announcement_outbox` row per channel. The five-minute cron drains the
 * outbox. It does not fan out inside the request that created the incident.
 *
 * A later visitor-subscription feature (email, webhook, RSS) should consume
 * this same event shape. Add a sink beside the channel outbox, or read
 * `announcement_events`. Do not thread subscription logic through the
 * incident or maintenance routes.
 *
 * Kinds:
 * - `incident.created` — an incident was opened
 * - `incident.updated` — title, impact, pages, or a timeline update changed,
 *   and the incident is still open (including a reopen)
 * - `incident.resolved` — the latest update became Resolved
 * - `maintenance.scheduled` — a window was created or its schedule changed,
 *   and the next occurrence is still in the future
 * - `maintenance.started` — an occurrence became active
 * - `maintenance.completed` — an occurrence ended
 *
 * Start and completed events are emitted by the cron for every window, at
 * most eight new signals per run, looking back six hours. Channel delivery
 * for those events is attached only when the window opted in.
 *
 * See docs/announcements.md.
 */

export const ANNOUNCEMENT_KINDS = [
  "incident.created",
  "incident.updated",
  "incident.resolved",
  "maintenance.scheduled",
  "maintenance.started",
  "maintenance.completed",
] as const;

export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

export type AnnouncementSubject = "incident" | "maintenance";

export type AnnouncementEvent = {
  kind: AnnouncementKind;
  organizationId: string;
  subjectType: AnnouncementSubject;
  subjectId: string;
  title: string;
  /** Plain-text summary. Markdown is not rendered in channel bodies. */
  summary: string;
  occurredAt: number;
  /** Public path such as `/s/status/incidents/…`, or null when no page is linked. */
  href: string | null;
};

export function isAnnouncementKind(value: string): value is AnnouncementKind {
  return (ANNOUNCEMENT_KINDS as readonly string[]).includes(value);
}

export function announcementHref(
  subject: AnnouncementSubject,
  slug: string | null,
  id: string,
): string | null {
  if (!slug) return null;
  if (subject === "incident") return `/s/${slug}/incidents/${id}`;
  return `/s/${slug}#maintenance`;
}
