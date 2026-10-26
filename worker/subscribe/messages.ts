// SPDX-License-Identifier: MIT

import { isAnnouncementKind } from "../../shared/announcements";
import { t } from "../../shared/copy";

export function unsubscribeHeaders(
  origin: string,
  token: string,
): Record<string, string> {
  const url = `${origin}/api/public/subscribe/unsubscribe/${encodeURIComponent(token)}`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function confirmMessage(input: {
  page: string;
  origin: string;
  confirm: string;
  manage: string;
  unsubscribe: string;
}): { subject: string; text: string; headers: Record<string, string> } {
  return {
    subject: t("mail_subscribe_confirm_subject", { page: input.page }),
    text: t("mail_subscribe_confirm_body", {
      page: input.page,
      confirm: `${input.origin}/subscribe/confirm/${input.confirm}`,
      manage: `${input.origin}/subscribe/manage/${input.manage}`,
      unsubscribe: `${input.origin}/subscribe/unsubscribe/${input.unsubscribe}`,
    }),
    headers: unsubscribeHeaders(input.origin, input.unsubscribe),
  };
}

export function alreadyMessage(input: {
  page: string;
  origin: string;
  manage: string;
  unsubscribe: string;
}): { subject: string; text: string; headers: Record<string, string> } {
  return {
    subject: t("mail_subscribe_again_subject", { page: input.page }),
    text: t("mail_subscribe_again_body", {
      page: input.page,
      manage: `${input.origin}/subscribe/manage/${input.manage}`,
      unsubscribe: `${input.origin}/subscribe/unsubscribe/${input.unsubscribe}`,
    }),
    headers: unsubscribeHeaders(input.origin, input.unsubscribe),
  };
}

export function noticeMessage(input: {
  page: string;
  origin: string;
  kind: string;
  title: string;
  summary: string;
  href: string | null;
  manage: string;
  unsubscribe: string;
}): { subject: string; text: string; headers: Record<string, string> } {
  const kindLabel = isAnnouncementKind(input.kind)
    ? t(
        input.kind === "incident.created"
          ? "announcement_incident_created"
          : input.kind === "incident.updated"
            ? "announcement_incident_updated"
            : input.kind === "incident.resolved"
              ? "announcement_incident_resolved"
              : input.kind === "maintenance.scheduled"
                ? "announcement_maintenance_scheduled"
                : input.kind === "maintenance.started"
                  ? "announcement_maintenance_started"
                  : "announcement_maintenance_completed",
      )
    : input.kind;
  const link = input.href
    ? new URL(input.href, input.origin).href
    : t("announcement_no_link");
  return {
    subject: t("mail_subscribe_notice_subject", {
      page: input.page,
      title: input.title,
    }),
    text: t("mail_subscribe_notice_body", {
      kind: kindLabel,
      title: input.title,
      summary: input.summary || t("announcement_no_summary"),
      link,
      manage: `${input.origin}/subscribe/manage/${input.manage}`,
      unsubscribe: `${input.origin}/subscribe/unsubscribe/${input.unsubscribe}`,
    }),
    headers: unsubscribeHeaders(input.origin, input.unsubscribe),
  };
}
