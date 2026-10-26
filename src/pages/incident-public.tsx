// SPDX-License-Identifier: MIT

import { formatDateTime, t } from "@shared/copy";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { incidentAlertVariant } from "@/ui/alert-variant";
import { api } from "../lib/api";
import { incidentStatusLabel } from "./announcement-fields";
import { Markdown } from "./markdown";
import { ErrorAlert, StatusNotice, StatusNoticeBadge } from "./status-notice";

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
        <ErrorAlert>{t("error_not_found")}</ErrorAlert>
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
      <StatusNotice
        className="mt-4"
        variant={incidentAlertVariant(incident.status, null, incident.monitors)}
        title={
          <h1 className="min-w-0 break-words text-3xl font-medium leading-tight tracking-tight">
            {incident.title}
          </h1>
        }
        badge={
          <StatusNoticeBadge>
            {incidentStatusLabel(incident.status)}
          </StatusNoticeBadge>
        }
      >
        {incident.monitors.length > 0 ? (
          <ul className="grid gap-1 text-sm">
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
      </StatusNotice>
      <ol className="mt-8 grid gap-4">
        {incident.updates.map((update) => (
          <li key={update.id} className="min-w-0">
            <StatusNotice
              variant={incidentAlertVariant(update.status)}
              title={
                <p className="text-sm font-medium leading-6">
                  {incidentStatusLabel(update.status)}
                </p>
              }
              badge={
                <time
                  className="text-xs whitespace-nowrap tabular-nums"
                  dateTime={new Date(update.postedAt).toISOString()}
                >
                  {formatDateTime(update.postedAt)}
                </time>
              }
            >
              <Markdown source={update.body} />
            </StatusNotice>
          </li>
        ))}
      </ol>
    </div>
  );
}
