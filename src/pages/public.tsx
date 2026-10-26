// SPDX-License-Identifier: MIT

import AppFooter from "@brand/overrides/AppFooter";
import StatusHero from "@brand/overrides/StatusHero";
import { formatDateTime, t } from "@shared/copy";
import type { HistoryBar } from "@shared/history";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Badge } from "@/ui/badge";
import { api } from "../lib/api";
import { incidentStatusLabel } from "./announcement-fields";
import { responseText, statusTone } from "./fields";
import { Markdown } from "./markdown";
import { UptimeBars } from "./uptime-bars";

type PublicPage = {
  slug: string;
  title: string;
  description: string;
  footer: string;
  banner: string;
  logoUrl?: string | null;
  accent?: string | null;
  displayRange: "24h" | "7d" | "30d" | "90d";
  bucket: "slot" | "hour" | "day";
  barCount: number;
  shownDays: number;
  clamped: boolean;
  retentionDays: number;
  overall:
    | "operational"
    | "degraded"
    | "outage"
    | "empty"
    | "paused"
    | "maintenance";
  incidents: {
    id: string;
    title: string;
    status: string;
    impact: string | null;
    message: string;
    monitors: { name: string; impact: string }[];
  }[];
  history: { id: string; title: string; resolvedAt: number }[];
  maintenance: {
    id: string;
    title: string;
    description: string;
    start: number;
    end: number;
    state: "active" | "upcoming";
    monitors: string[];
  }[];
  groups: {
    name: string;
    items: {
      id: string;
      name: string;
      status: string;
      uptime: number | null;
      responseMs: number | null;
      maint: number;
      bars: HistoryBar[];
    }[];
  }[];
};

function configuredLabel(range: PublicPage["displayRange"]): string {
  if (range === "24h") return t("range_24h");
  if (range === "7d") return t("range_7d");
  if (range === "30d") return t("range_30d");
  return t("range_90d");
}

function shownLabel(page: PublicPage): string {
  if (page.shownDays <= 1) return t("range_24h");
  return t("status_shown_days", { count: page.shownDays });
}

function statusLabel(status: string) {
  if (status === "up") return t("status_up");
  if (status === "down") return t("status_down");
  if (status === "pending") return t("status_pending");
  if (status === "paused") return t("status_paused");
  if (
    status === "degraded" ||
    status === "partial_outage" ||
    status === "major_outage" ||
    status === "maintenance" ||
    status === "investigating" ||
    status === "identified" ||
    status === "monitoring" ||
    status === "resolved"
  ) {
    return incidentStatusLabel(status);
  }
  return t("status_unknown");
}

export function PublicStatusPage() {
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = params.slug;
  const page = useQuery({
    queryKey: ["public", slug ?? "root"],
    queryFn: () =>
      api<PublicPage>(slug ? `/api/public/status/${slug}` : "/api/public/root"),
  });
  const data = page.data;
  if (!data) return <p className="p-8">{t("loading")}</p>;
  return (
    <div className="mx-auto min-w-0 max-w-3xl px-4 py-10">
      {data.logoUrl ? (
        <img
          src={data.logoUrl}
          alt=""
          className="mb-4 h-10 max-w-full object-contain"
        />
      ) : null}
      {data.accent && /^#[0-9a-fA-F]{6}$/.test(data.accent) ? (
        <div
          className="mb-4 h-1 w-16 rounded-full"
          style={{ backgroundColor: data.accent }}
        />
      ) : null}
      <StatusHero
        title={data.title}
        description={data.description}
        banner={data.banner}
        overall={data.overall}
      />
      {(data.incidents?.length ?? 0) > 0 ? (
        <section className="mt-8 grid gap-3" aria-label={t("status_incidents")}>
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("status_incidents")}
          </h2>
          {data.incidents.map((incident) => (
            <article
              key={incident.id}
              className="min-w-0 rounded-lg border border-status-down/40 bg-card p-4"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 break-words text-lg font-medium">
                  <Link
                    to="/s/$slug/incidents/$incidentId"
                    params={{ slug: data.slug, incidentId: incident.id }}
                    className="break-words underline-offset-2 hover:underline"
                    title={incident.title}
                  >
                    {incident.title}
                  </Link>
                </h3>
                <Badge tone={statusTone(incident.status)}>
                  {statusLabel(incident.status)}
                </Badge>
              </div>
              <div className="mt-2">
                <Markdown source={incident.message} />
              </div>
              {incident.monitors.length > 0 ? (
                <p className="mt-2 text-xs break-words text-muted-foreground">
                  {incident.monitors
                    .map(
                      (monitor) =>
                        `${monitor.name} (${incidentStatusLabel(monitor.impact)})`,
                    )
                    .join(", ")}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {(data.maintenance?.length ?? 0) > 0 ? (
        <section
          id="maintenance"
          className="mt-8 grid gap-3"
          aria-label={t("status_maintenance_section")}
        >
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("status_maintenance_section")}
          </h2>
          {data.maintenance.map((window) => (
            <article
              key={window.id}
              className="min-w-0 rounded-lg border border-primary/30 bg-card p-4"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3
                  className="min-w-0 break-words font-medium"
                  title={window.title}
                >
                  {window.title}
                </h3>
                <Badge tone="maintenance">
                  {window.state === "active"
                    ? t("public_maintenance_active")
                    : t("public_maintenance_upcoming")}
                </Badge>
              </div>
              {window.description ? (
                <p className="mt-2 text-sm break-words text-muted-foreground">
                  {window.description}
                </p>
              ) : null}
              <p className="mt-2 min-w-0 break-words text-xs tabular-nums text-muted-foreground">
                {formatDateTime(window.start)} – {formatDateTime(window.end)}
              </p>
              {window.monitors.length > 0 ? (
                <p className="mt-1 text-xs break-words text-muted-foreground">
                  {window.monitors.join(", ")}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {data.clamped ? (
        <p className="mt-4 max-w-full text-sm break-words text-muted-foreground">
          {t("status_range_clamped", {
            configured: configuredLabel(data.displayRange),
            retention: data.retentionDays,
            shown: shownLabel(data),
          })}
        </p>
      ) : null}
      <div className="mt-8 grid gap-6">
        {data.groups.map((group) => (
          <section key={group.name || "default"}>
            {group.name ? (
              <h2
                className="mb-2 min-w-0 truncate text-sm font-medium text-muted-foreground"
                title={group.name}
              >
                {group.name}
              </h2>
            ) : null}
            <div className="grid gap-3">
              {group.items.map((item) => (
                <article
                  key={item.id}
                  className="min-w-0 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <h3
                      className="min-w-0 truncate font-medium"
                      title={item.name || t("monitor_fallback_name")}
                    >
                      {item.name || t("monitor_fallback_name")}
                    </h3>
                    <Badge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">
                    {shownLabel(data)}{" "}
                    {item.uptime === null
                      ? (item.maint ?? 0) > 0
                        ? t("uptime_maintenance")
                        : t("uptime_empty")
                      : t("uptime_percent", { value: item.uptime })}
                    {" · "}
                    {t("response_label")} {responseText(item.responseMs)}
                  </p>
                  <UptimeBars bars={item.bars} />
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {(data.history?.length ?? 0) > 0 ? (
        <section className="mt-8" aria-label={t("status_history")}>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            {t("status_history")}
          </h2>
          <div className="grid gap-2">
            {data.history.map((incident) => (
              <Link
                key={incident.id}
                to="/s/$slug/incidents/$incidentId"
                params={{ slug: data.slug, incidentId: incident.id }}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words">{incident.title}</span>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(incident.resolvedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {data.footer ? (
        <p className="mt-8 text-sm text-muted-foreground">{data.footer}</p>
      ) : null}
      <AppFooter />
    </div>
  );
}
