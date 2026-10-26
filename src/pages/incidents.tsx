// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { formatDateTime, t } from "@shared/copy";
import { can } from "@shared/permissions";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { incidentAlertVariant } from "@/ui/alert-variant";
import { Button } from "@/ui/button";
import { incidentsQuery } from "../lib/queries";
import { useRole } from "../lib/use-role";
import { Stagger, StaggerItem } from "../motion/page";
import { ContentSkeleton } from "../ui/skeleton";
import { incidentStatusLabel } from "./announcement-fields";
import { StatusNotice, StatusNoticeBadge } from "./status-notice";

export function IncidentsPage() {
  const role = useRole();
  const writable = role ? can({ role }, "incidents.write") : false;
  const [state, setState] = useState<"active" | "resolved">("active");
  const incidents = useQuery(incidentsQuery(state));
  return (
    <div className="min-w-0">
      <AppHeader
        title={t("nav_incidents")}
        actions={
          writable ? (
            <Button asChild>
              <Link to="/console/incidents/new">{t("incident_new")}</Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {(["active", "resolved"] as const).map((tab) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={state === tab ? "default" : "outline"}
            aria-pressed={state === tab}
            onClick={() => setState(tab)}
          >
            {tab === "active"
              ? t("incident_active")
              : t("incident_resolved_tab")}
          </Button>
        ))}
      </div>
      {incidents.isPending ? <ContentSkeleton /> : null}
      {(incidents.data?.incidents.length ?? 0) === 0 && !incidents.isPending ? (
        <p className="text-sm text-muted-foreground">
          {state === "active"
            ? t("incident_empty")
            : t("incident_empty_resolved")}
        </p>
      ) : null}
      <Stagger className="grid gap-2">
        {incidents.data?.incidents.map((incident) => (
          <StaggerItem key={incident.id}>
            <Link
              to="/console/incidents/$id"
              params={{ id: incident.id }}
              className="block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StatusNotice
                className="h-full motion-safe:transition-[filter] motion-safe:duration-150 hover:brightness-95"
                variant={incidentAlertVariant(incident.status)}
                title={
                  <h2 className="min-w-0 break-words font-medium leading-6">
                    {incident.title}
                  </h2>
                }
                badge={
                  <StatusNoticeBadge>
                    {incidentStatusLabel(incident.status)}
                  </StatusNoticeBadge>
                }
              >
                <p className="line-clamp-2 break-words text-sm">
                  {incident.message}
                </p>
                <p className="text-xs tabular-nums">
                  {formatDateTime(incident.updatedAt)}
                </p>
              </StatusNotice>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
