// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { formatDateTime, t } from "@shared/copy";
import { can } from "@shared/permissions";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { incidentsQuery } from "../lib/queries";
import { useRole } from "../lib/use-role";
import { Stagger, StaggerItem } from "../motion/page";
import { ContentSkeleton } from "../ui/skeleton";
import { incidentStatusLabel } from "./announcement-fields";
import { statusTone } from "./fields";

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
              className="block min-w-0 rounded-lg border border-border bg-card p-4 hover:bg-muted/40"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 break-words font-medium">
                  {incident.title}
                </h2>
                <Badge tone={statusTone(incident.status)}>
                  {incidentStatusLabel(incident.status)}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-sm break-words text-muted-foreground">
                {incident.message}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDateTime(incident.updatedAt)}
              </p>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
