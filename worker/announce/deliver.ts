// SPDX-License-Identifier: MIT

import type {
  AnnouncementEvent,
  AnnouncementKind,
} from "../../shared/announcements";
import type { NoticeKind } from "../notify/copy";
import {
  type ChannelDelivery,
  deliverPrepared,
  type PreparedDelivery,
} from "../notify/dispatch";
import { announcementMessage } from "./text";

/**
 * Channel transport for announcement events. The HTTP shapes match monitor
 * alerts, including ntfy, Gotify, Pushover, Teams, Google Chat, and Matrix.
 * A created incident pages at down severity. A resolve or a finished window
 * pages at up. Every other kind pages at the flapping level.
 */
export function announcementSeverity(kind: AnnouncementKind): NoticeKind {
  if (kind === "incident.resolved" || kind === "maintenance.completed")
    return "up";
  if (kind === "incident.created") return "down";
  return "unstable";
}

export async function deliverAnnouncement(
  channel: ChannelDelivery,
  event: AnnouncementEvent,
  deps: {
    fetch?: typeof fetch;
    enqueueEmail?: (input: {
      to: string;
      subject: string;
      text: string;
    }) => Promise<void>;
  },
): Promise<{ ok: boolean; error?: string }> {
  const text = announcementMessage(event);
  const webhook: PreparedDelivery["webhook"] = {
    event: event.kind,
    title: event.title,
    summary: event.summary,
    href: event.href,
    occurredAt: event.occurredAt,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    text: text.body,
  };
  return deliverPrepared(
    channel,
    {
      subject: text.subject,
      body: text.body,
      severity: announcementSeverity(event.kind),
      subtitle: event.title,
      webhook,
    },
    deps,
  );
}
