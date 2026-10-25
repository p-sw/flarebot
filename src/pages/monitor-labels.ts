// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";

export function monitorTypeLabel(type: string): string {
  if (type === "http") return t("monitor_type_http");
  if (type === "tcp") return t("monitor_type_tcp");
  if (type === "dns") return t("monitor_type_dns");
  if (type === "ssl") return t("monitor_type_ssl");
  return t("monitor_type_heartbeat");
}

export function monitorStatusLabel(status: string): string {
  if (status === "up") return t("status_up");
  if (status === "down") return t("status_down");
  if (status === "pending") return t("status_pending");
  if (status === "paused") return t("status_paused");
  return t("status_unknown");
}
