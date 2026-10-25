// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import EmptyState from "@brand/overrides/EmptyState";
import { formatDateTime, formatTime, t } from "@shared/copy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
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
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { ApiClientError, api, errorText } from "../lib/api";
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
import { controlClass, Field, statusTone } from "./fields";

const types = ["http", "tcp", "dns", "ssl", "heartbeat"] as const;

function typeLabel(type: string) {
  if (type === "http") return t("monitor_type_http");
  if (type === "tcp") return t("monitor_type_tcp");
  if (type === "dns") return t("monitor_type_dns");
  if (type === "ssl") return t("monitor_type_ssl");
  return t("monitor_type_heartbeat");
}

function statusLabel(status: string) {
  if (status === "up") return t("status_up");
  if (status === "down") return t("status_down");
  if (status === "pending") return t("status_pending");
  if (status === "paused") return t("status_paused");
  return t("status_unknown");
}

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
                      {typeLabel(row.type)}
                    </p>
                  </Link>
                  <div className="flex max-w-full flex-wrap items-center gap-3 text-sm">
                    <span>
                      {row.uptime24 === null
                        ? t("uptime_empty")
                        : t("uptime_percent", { value: row.uptime24 })}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {row.lastResponseMs == null
                        ? t("uptime_empty")
                        : t("response_ms", { value: row.lastResponseMs })}
                    </span>
                    <Badge tone={statusTone(row.status)}>
                      {statusLabel(row.status)}
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

type Draft = {
  name: string;
  type: (typeof types)[number];
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  recoveryThreshold: number;
  url: string;
  host: string;
  port: number;
  dnsName: string;
  dnsType: "A" | "AAAA" | "CNAME" | "MX" | "TXT";
  expected: string;
  warnDays: number;
  graceSeconds: number;
};

const blank: Draft = {
  name: "",
  type: "http",
  intervalSeconds: 60,
  timeoutSeconds: 10,
  retries: 2,
  recoveryThreshold: 1,
  url: "https://example.com",
  host: "1.1.1.1",
  port: 443,
  dnsName: "example.com",
  dnsType: "A",
  expected: "1.1.1.1",
  warnDays: 14,
  graceSeconds: 30,
};

function configFrom(draft: Draft) {
  if (draft.type === "http")
    return {
      url: draft.url,
      method: "GET",
      expectedStatuses: [200],
      followRedirects: true,
    };
  if (draft.type === "tcp")
    return { host: draft.host, port: Number(draft.port) };
  if (draft.type === "dns")
    return {
      name: draft.dnsName,
      type: draft.dnsType,
      expected: draft.expected
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
  if (draft.type === "ssl")
    return { host: draft.host, warnDays: Number(draft.warnDays) };
  return { graceSeconds: Number(draft.graceSeconds) };
}

export function MonitorFormPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const submit = useSubmitGuard();
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string; pushUrl?: string }>("/api/monitors", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          type: draft.type,
          config: configFrom(draft),
          intervalSeconds: Number(draft.intervalSeconds),
          timeoutSeconds: Number(draft.timeoutSeconds),
          retries: Number(draft.retries),
          recoveryThreshold: Number(draft.recoveryThreshold),
          channelIds: [],
        }),
      }),
    onSuccess: async (data) => {
      await refreshQueries(client, [["monitors"]]);
      if (data.pushUrl) setPushUrl(data.pushUrl);
      else navigate({ to: "/console/monitors/$id", params: { id: data.id } });
    },
    onError: (cause) => setError(errorText(cause)),
  });
  return (
    <>
      <AppHeader title={t("monitor_new")} />
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run(async () => {
            try {
              await save.mutateAsync();
            } catch {
              // onError records the message.
            }
          });
        }}
      >
        <Field label={t("monitor_name")}>
          <Input
            name="name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            required
          />
        </Field>
        <Field label={t("monitor_type")}>
          <select
            className={controlClass}
            name="type"
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as Draft["type"] })
            }
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </Field>
        {draft.type === "http" ? (
          <Field label={t("monitor_url")}>
            <Input
              name="url"
              value={draft.url}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
            />
          </Field>
        ) : null}
        {draft.type === "tcp" || draft.type === "ssl" ? (
          <Field label={t("monitor_host")}>
            <Input
              name="host"
              value={draft.host}
              onChange={(event) =>
                setDraft({ ...draft, host: event.target.value })
              }
            />
          </Field>
        ) : null}
        {draft.type === "tcp" ? (
          <Field label={t("monitor_port")}>
            <Input
              name="port"
              type="number"
              value={draft.port}
              onChange={(event) =>
                setDraft({ ...draft, port: Number(event.target.value) })
              }
            />
          </Field>
        ) : null}
        {draft.type === "dns" ? (
          <>
            <Field label={t("monitor_dns_name")}>
              <Input
                name="dnsName"
                value={draft.dnsName}
                onChange={(event) =>
                  setDraft({ ...draft, dnsName: event.target.value })
                }
              />
            </Field>
            <Field label={t("monitor_dns_type")}>
              <Input
                name="dnsType"
                value={draft.dnsType}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    dnsType: event.target.value as Draft["dnsType"],
                  })
                }
              />
            </Field>
            <Field label={t("monitor_dns_expected")}>
              <Input
                name="expected"
                value={draft.expected}
                onChange={(event) =>
                  setDraft({ ...draft, expected: event.target.value })
                }
              />
            </Field>
          </>
        ) : null}
        {draft.type === "ssl" ? (
          <>
            <Field label={t("monitor_ssl_warn")}>
              <Input
                name="warnDays"
                type="number"
                value={draft.warnDays}
                onChange={(event) =>
                  setDraft({ ...draft, warnDays: Number(event.target.value) })
                }
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t("monitor_ssl_estimate")}
            </p>
          </>
        ) : null}
        {draft.type === "heartbeat" ? (
          <Field label={t("monitor_interval")}>
            <Input
              name="grace"
              type="number"
              value={draft.graceSeconds}
              onChange={(event) =>
                setDraft({ ...draft, graceSeconds: Number(event.target.value) })
              }
            />
          </Field>
        ) : null}
        <Field label={t("monitor_interval")}>
          <Input
            name="interval"
            type="number"
            min={60}
            value={draft.intervalSeconds}
            onChange={(event) =>
              setDraft({
                ...draft,
                intervalSeconds: Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label={t("monitor_retries")}>
          <Input
            name="retries"
            type="number"
            min={1}
            value={draft.retries}
            onChange={(event) =>
              setDraft({ ...draft, retries: Number(event.target.value) })
            }
          />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {pushUrl ? (
          <div className="rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{t("monitor_push_url")}</p>
            <p className="mt-1 break-all font-mono text-xs">{pushUrl}</p>
            <p className="mt-2 text-muted-foreground">
              {t("monitor_push_hint")}
            </p>
          </div>
        ) : (
          <PendingButton type="submit" pending={submit.pending}>
            {t("action_create")}
          </PendingButton>
        )}
      </form>
    </>
  );
}

export function MonitorDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
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
      {pause.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {pause.error}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
        <span className="text-sm text-muted-foreground">
          {typeLabel(row.type)}
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
