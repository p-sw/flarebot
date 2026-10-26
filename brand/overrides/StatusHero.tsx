// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";

export default function StatusHero({
  title,
  description,
  banner,
  overall,
}: {
  title: string;
  description: string;
  banner: string;
  overall:
    | "operational"
    | "degraded"
    | "outage"
    | "empty"
    | "paused"
    | "maintenance";
}) {
  const label =
    overall === "outage"
      ? t("status_all_down")
      : overall === "degraded"
        ? t("status_some_down")
        : overall === "paused"
          ? t("status_all_paused")
          : overall === "empty"
            ? t("status_empty")
            : overall === "maintenance"
              ? t("status_all_maintenance")
              : t("status_all_operational");
  const tone =
    overall === "outage" || overall === "degraded"
      ? "bg-status-down"
      : overall === "maintenance"
        ? "bg-primary"
        : overall === "paused" || overall === "empty"
          ? "bg-status-unknown"
          : "bg-status-up";
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-6 sm:p-8">
      <p className="text-sm text-muted-foreground">
        {t("status_hero_tagline")}
      </p>
      <h1
        className="mt-2 min-w-0 break-words text-3xl font-medium tracking-tight"
        title={title}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-2 max-w-2xl break-words text-muted-foreground">
          {description}
        </p>
      ) : null}
      <p className="mt-6 inline-flex max-w-full items-center gap-2 text-sm font-medium">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
        <span className="min-w-0 truncate">{label}</span>
      </p>
      {banner ? (
        <p className="mt-4 break-words rounded-lg bg-muted px-3 py-2 text-sm">
          {banner}
        </p>
      ) : null}
    </section>
  );
}
