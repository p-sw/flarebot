// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import {
  Activity,
  Globe,
  Lock,
  type LucideIcon,
  Network,
  Radio,
} from "lucide-react";
import { cn } from "../../lib/cn";

const typeIcons: Record<string, LucideIcon> = {
  http: Globe,
  tcp: Network,
  dns: Radio,
  ssl: Lock,
  heartbeat: Activity,
};

export function monitorTypeLabel(type: string): string {
  if (type === "http") return t("monitor_type_http");
  if (type === "tcp") return t("monitor_type_tcp");
  if (type === "dns") return t("monitor_type_dns");
  if (type === "ssl") return t("monitor_type_ssl");
  if (type === "heartbeat") return t("monitor_type_heartbeat");
  return "";
}

export function monitorStatusLabel(status: string): string {
  if (status === "up") return t("status_up");
  if (status === "down") return t("status_down");
  if (status === "pending") return t("status_pending");
  if (status === "paused") return t("status_paused");
  return t("status_unknown");
}

export function monitorSearchText(monitor: {
  name: string;
  type?: string;
  status?: string;
  target?: string;
}): string {
  const type = monitor.type ?? "";
  const status = monitor.status ?? "";
  return [
    monitor.name,
    type,
    type ? monitorTypeLabel(type) : "",
    monitor.target ?? "",
    status,
    status ? monitorStatusLabel(status) : "",
  ].join(" ");
}

function statusDotClass(status: string): string {
  if (status === "up") return "bg-status-up";
  if (status === "down") return "bg-status-down";
  if (status === "pending") return "bg-status-pending";
  if (status === "paused") return "bg-muted-foreground";
  return "bg-status-unknown";
}

export function StatusDot({ status }: { status: string }) {
  const label = monitorStatusLabel(status);
  return (
    <span className="inline-flex h-2.5 w-2.5 shrink-0" title={label}>
      <span
        className={cn("h-2.5 w-2.5 rounded-full", statusDotClass(status))}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function MonitorTypeIcon({ type }: { type: string }) {
  const Icon = typeIcons[type];
  if (!Icon) return null;
  return (
    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}
