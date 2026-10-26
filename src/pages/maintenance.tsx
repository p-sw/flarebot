// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { t, textLang } from "@shared/copy";
import { can } from "@shared/permissions";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { maintenanceListQuery } from "../lib/queries";
import { useRole } from "../lib/use-role";
import { Stagger, StaggerItem } from "../motion/page";
import { ContentSkeleton } from "../ui/skeleton";

function formatRange(start: number, end: number, timeZone: string): string {
  const format = new Intl.DateTimeFormat(textLang, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${format.format(start)} – ${format.format(end)}`;
}

export function MaintenancePage() {
  const role = useRole();
  const writable = role ? can({ role }, "maintenance.write") : false;
  const [view, setView] = useState<"upcoming" | "active" | "past">("upcoming");
  const windows = useQuery(maintenanceListQuery(view));
  return (
    <div className="min-w-0">
      <AppHeader
        title={t("nav_maintenance")}
        actions={
          writable ? (
            <Button asChild>
              <Link to="/console/maintenance/new">{t("maintenance_new")}</Link>
            </Button>
          ) : null
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        {t("maintenance_intro")}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["upcoming", "active", "past"] as const).map((tab) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={view === tab ? "default" : "outline"}
            aria-pressed={view === tab}
            onClick={() => setView(tab)}
          >
            {tab === "upcoming"
              ? t("maintenance_upcoming")
              : tab === "active"
                ? t("maintenance_active")
                : t("maintenance_past")}
          </Button>
        ))}
      </div>
      {windows.isPending ? <ContentSkeleton /> : null}
      {(windows.data?.windows.length ?? 0) === 0 && !windows.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t("maintenance_empty")}
        </p>
      ) : null}
      <Stagger className="grid gap-2">
        {windows.data?.windows.map((window) => (
          <StaggerItem key={window.id}>
            <Link
              to="/console/maintenance/$id"
              params={{ id: window.id }}
              className="block min-w-0 rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 break-words font-medium">
                  {window.title}
                </h2>
                <Badge
                  tone={window.state === "active" ? "maintenance" : "neutral"}
                >
                  {window.state === "active"
                    ? t("maintenance_active")
                    : window.state === "past"
                      ? t("maintenance_past")
                      : t("maintenance_upcoming")}
                </Badge>
              </div>
              <p className="mt-1 text-sm break-words text-muted-foreground">
                {window.next
                  ? formatRange(
                      window.next.start,
                      window.next.end,
                      window.timezone,
                    )
                  : formatRange(window.startAt, window.endAt, window.timezone)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {window.timezone}
                {" · "}
                {window.recurrence === "daily"
                  ? t("maintenance_daily")
                  : window.recurrence === "weekly"
                    ? t("maintenance_weekly")
                    : window.recurrence === "monthly"
                      ? t("maintenance_monthly")
                      : t("maintenance_once")}
              </p>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
