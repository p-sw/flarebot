// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import EmptyState from "@brand/overrides/EmptyState";
import { formatDateTime, formatTime, t } from "@shared/copy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { Loader2, Pause, Play } from "lucide-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { PendingButton } from "@/ui/pending-button";
import { ApiClientError, api } from "../lib/api";
import {
  type MonitorDetail,
  monitorQuery,
  monitorsQuery,
  outagesQuery,
  statsQuery,
} from "../lib/queries";
import { commitMonitor, dropMonitor, refreshQueries } from "../lib/query-sync";
import { useToggleLock } from "../lib/toggle-guard";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Stagger, StaggerItem } from "../motion/page";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContentSkeleton } from "../ui/skeleton";
import { responseText, statusTone } from "./fields";
import { MonitorConfig } from "./monitor-config";
import { monitorStatusLabel, monitorTypeLabel } from "./monitor-labels";

function PauseControl({
  paused,
  pending,
  disabled,
  onClick,
}: {
  paused: boolean;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : paused ? (
        <Play className="h-4 w-4" aria-hidden />
      ) : (
        <Pause className="h-4 w-4" aria-hidden />
      )}
      {paused ? t("action_resume") : t("action_pause")}
    </Button>
  );
}

function useMonitorPause() {
  const client = useQueryClient();
  const toggles = useToggleLock();
  const [error, setError] = useState("");
  async function toggle(id: string, paused: boolean) {
    setError("");
    await toggles.run(id, async () => {
      try {
        const monitor = await api<MonitorDetail>(`/api/monitors/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ paused: !paused }),
        });
        commitMonitor(client, monitor);
        await refreshQueries(client, [["public"]]);
      } catch (cause) {
        setError(
          cause instanceof ApiClientError && cause.code === "forbidden"
            ? t("error_forbidden")
            : t("error_monitor_pause"),
        );
      }
    });
  }
  return {
    toggle,
    pendingKey: toggles.pendingKey,
    pending: toggles.pending,
    error,
  };
}

export function DashboardPage() {
  const monitors = useQuery(monitorsQuery);
  const pause = useMonitorPause();
  const rows = monitors.data?.monitors ?? [];
  return (
    <>
      <AppHeader
        title={t("nav_dashboard")}
        actions={
          <Link to="/console/monitors/new">
            <Button>{t("monitor_new")}</Button>
          </Link>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {t("monitors_count", { count: rows.length })}
      </p>
      {pause.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {pause.error}
        </p>
      ) : null}
      {monitors.isPending ? (
        <ContentSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          action={
            <Link to="/console/monitors/new">
              <Button>{t("monitor_new")}</Button>
            </Link>
          }
        />
      ) : (
        <Stagger className="grid gap-3">
          {rows.map((row) => (
            <StaggerItem key={row.id}>
              <Card>
                <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-4 p-5">
                  <Link
                    to="/console/monitors/$id"
                    params={{ id: row.id }}
                    className="min-w-0 flex-1"
                  >
                    <p className="break-words font-medium">{row.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {monitorTypeLabel(row.type)}
                    </p>
                    {row.target ? (
                      <p className="break-all text-sm text-muted-foreground">
                        {row.target}
                      </p>
                    ) : null}
                  </Link>
                  <div className="flex max-w-full flex-wrap items-center gap-3 text-sm">
                    <span>
                      {row.uptime24 === null
                        ? t("uptime_empty")
                        : t("uptime_percent", { value: row.uptime24 })}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {responseText(row.lastResponseMs)}
                    </span>
                    <Badge tone={statusTone(row.status)}>
                      {monitorStatusLabel(row.status)}
                    </Badge>
                    <PauseControl
                      paused={row.paused}
                      pending={pause.pendingKey === row.id}
                      disabled={pause.pending}
                      onClick={() => void pause.toggle(row.id, row.paused)}
                    />
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}

export function MonitorDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { saved } = useSearch({ strict: false }) as { saved?: 1 };
  const client = useQueryClient();
  const navigate = useNavigate();
  const monitor = useQuery(monitorQuery(id));
  const stats = useQuery(statsQuery(id));
  const outages = useQuery(outagesQuery(id));
  const row = monitor.data;
  const action = useSubmitGuard();
  const pause = useMonitorPause();
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (monitor.isPending) return <ContentSkeleton />;
  if (!row) return <p>{t("loading")}</p>;
  const recent = stats.data?.recent ?? [];
  return (
    <>
      <AppHeader
        title={row.name}
        actions={
          <>
            <Link to="/console/monitors/$id/edit" params={{ id: row.id }}>
              <Button variant="outline" type="button">
                {t("action_edit")}
              </Button>
            </Link>
            <PauseControl
              paused={row.paused}
              pending={pause.pendingKey === id}
              disabled={pause.pending}
              onClick={() => void pause.toggle(id, row.paused)}
            />
            <PendingButton
              variant="destructive"
              type="button"
              pending={action.pending}
              onClick={() => setConfirmDelete(true)}
            >
              {t("action_delete")}
            </PendingButton>
            <ConfirmDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title={t("action_delete")}
              description={t("monitor_delete_confirm")}
              confirmLabel={t("action_delete")}
              cancelLabel={t("action_cancel")}
              pending={action.pending}
              onConfirm={() => {
                void action.run(async () => {
                  await api(`/api/monitors/${id}`, { method: "DELETE" });
                  dropMonitor(client, id);
                  await refreshQueries(client, [["monitors"], ["public"]]);
                  setConfirmDelete(false);
                  await navigate({ to: "/console" });
                });
              }}
            />
          </>
        }
      />
      {saved ? (
        <p role="status" className="mb-4 text-sm">
          {t("monitor_saved")}
        </p>
      ) : null}
      {pause.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {pause.error}
        </p>
      ) : null}
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-3">
        <Badge tone={statusTone(row.status)}>
          {monitorStatusLabel(row.status)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {monitorTypeLabel(row.type)}
        </span>
        {row.lastError ? (
          <span className="text-sm">{row.lastError}</span>
        ) : null}
      </div>
      {row.pushUrl ? (
        <p className="mb-4 break-all rounded-lg bg-muted p-3 font-mono text-xs">
          {t("monitor_push_url")}: {row.pushUrl}
        </p>
      ) : null}
      <MonitorConfig monitor={row} />
      <Stagger className="mb-4 grid gap-3 sm:grid-cols-4">
        {(["h24", "d7", "d30", "d90"] as const).map((key) => (
          <StaggerItem key={key}>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  {key === "h24"
                    ? t("range_24h")
                    : key === "d7"
                      ? t("range_7d")
                      : key === "d30"
                        ? t("range_30d")
                        : t("range_90d")}
                </p>
                <p className="text-2xl font-medium">
                  {stats.data?.uptime[key] == null
                    ? t("uptime_empty")
                    : t("uptime_percent", { value: stats.data.uptime[key] })}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
      {stats.data ? (
        <p className="mb-4 max-w-full text-xs break-words text-muted-foreground">
          {t("monitor_history_note", { days: stats.data.retentionDays })}
        </p>
      ) : null}
      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {t("chart_response")} ·{" "}
            {t("chart_p95", { value: stats.data?.p95 ?? 0 })}
          </p>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("chart_empty")}</p>
          ) : (
            <div className="h-48 min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={recent.map((point) => ({
                    ...point,
                    label: formatTime(point.t),
                  }))}
                >
                  <XAxis dataKey="label" hide />
                  <YAxis width={32} />
                  <Tooltip />
                  <Area
                    dataKey="ms"
                    name={t("chart_series_ms")}
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div
            className="mt-3 flex h-8 min-w-0 items-end gap-px"
            role="img"
            aria-label={t("chart_recent")}
          >
            {recent.slice(-60).map((point) => (
              <div
                key={point.t}
                className={`min-w-0 flex-1 ${point.ok ? "bg-status-up" : "bg-status-down"}`}
                style={{
                  height: Math.max(4, Math.min(32, point.ms / 30)),
                }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
      <h2 className="mb-2 font-medium">{t("monitor_outages")}</h2>
      {(outages.data?.outages.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("monitor_no_outages")}
        </p>
      ) : null}
      {outages.isPending ? <ContentSkeleton /> : null}
      <Stagger className="grid gap-2">
        {outages.data?.outages.map((outage) => (
          <StaggerItem key={outage.id}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span>{outage.cause || t("outage_cause")}</span>
              <span className="text-muted-foreground">
                {outage.endedAt
                  ? formatDateTime(outage.endedAt)
                  : t("outage_ongoing")}
              </span>
              {!outage.acknowledgedAt ? (
                <PendingButton
                  size="sm"
                  variant="outline"
                  type="button"
                  pending={action.pending}
                  onClick={() => {
                    void action.run(async () => {
                      await api(`/api/outages/${outage.id}/ack`, {
                        method: "POST",
                      });
                      await refreshQueries(client, [["outages", id]]);
                    });
                  }}
                >
                  {t("monitor_ack")}
                </PendingButton>
              ) : null}
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  );
}
