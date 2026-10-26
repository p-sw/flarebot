// SPDX-License-Identifier: MIT

import type {
  AnnouncementEvent,
  AnnouncementKind,
} from "../../shared/announcements";
import { t } from "../../shared/copy";

export function announcementKindLabel(kind: AnnouncementKind): string {
  switch (kind) {
    case "incident.created":
      return t("announcement_incident_created");
    case "incident.updated":
      return t("announcement_incident_updated");
    case "incident.resolved":
      return t("announcement_incident_resolved");
    case "maintenance.scheduled":
      return t("announcement_maintenance_scheduled");
    case "maintenance.started":
      return t("announcement_maintenance_started");
    case "maintenance.completed":
      return t("announcement_maintenance_completed");
  }
}

export function announcementMessage(event: AnnouncementEvent): {
  subject: string;
  body: string;
} {
  const summary = event.summary.trim() || t("announcement_no_summary");
  const link = event.href ?? t("announcement_no_link");
  return {
    subject: t("announcement_subject", { title: event.title }),
    body: t("announcement_body", {
      kind: announcementKindLabel(event.kind),
      title: event.title,
      summary,
      link,
    }),
  };
}
