// SPDX-License-Identifier: MIT

import { formatDateTime, t } from "@shared/copy";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Badge } from "@/ui/badge";
import { api } from "../lib/api";
import { incidentStatusLabel } from "./announcement-fields";
import { statusTone } from "./fields";
import { Markdown } from "./markdown";

type Detail = {
  slug: string;
  incident: {
    id: string;
    title: string;
    status: string;
    monitors: { name: string; impact: string }[];
    updates: { id: string; status: string; body: string; postedAt: number }[];
  };
};

export function PublicIncidentPage() {
  const { slug, incidentId } = useParams({ strict: false }) as {
    slug: string;
    incidentId: string;
  };
  const detail = useQuery({
    queryKey: ["public-incident", slug, incidentId],
    queryFn: () =>
      api<Detail>(`/api/public/status/${slug}/incidents/${incidentId}`),
  });
  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-destructive">{t("error_not_found")}</p>
        <Link
          to="/s/$slug"
          params={{ slug }}
          className="mt-4 inline-block text-sm underline"
        >
          {t("incident_detail_back")}
        </Link>
      </div>
    );
  }
  if (!detail.data) return <p className="p-8">{t("loading")}</p>;
  const incident = detail.data.incident;
  return (
    <div className="mx-auto min-w-0 max-w-3xl px-4 py-10">
      <Link
        to="/s/$slug"
        params={{ slug }}
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        {t("incident_detail_back")}
      </Link>
      <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 break-words text-3xl font-medium tracking-tight">
          {incident.title}
        </h1>
        <Badge tone={statusTone(incident.status)}>
          {incidentStatusLabel(incident.status)}
        </Badge>
      </div>
      {incident.monitors.length > 0 ? (
        <ul className="mt-4 grid gap-1 text-sm">
          {incident.monitors.map((monitor) => (
            <li
              key={`${monitor.name}-${monitor.impact}`}
              className="break-words"
            >
              {monitor.name}
              {" · "}
              {incidentStatusLabel(monitor.impact)}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="mt-8 grid gap-4">
        {incident.updates.map((update) => (
          <li
            key={update.id}
            className="min-w-0 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {incidentStatusLabel(update.status)}
              </p>
              <time
                className="text-xs text-muted-foreground"
                dateTime={new Date(update.postedAt).toISOString()}
              >
                {formatDateTime(update.postedAt)}
              </time>
            </div>
            <div className="mt-2">
              <Markdown source={update.body} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
