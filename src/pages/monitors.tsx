// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import EmptyState from "@brand/overrides/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
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
import { api, errorText } from "../lib/api";
import {
  monitorQuery,
  monitorsQuery,
  outagesQuery,
  statsQuery,
} from "../lib/queries";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Stagger, StaggerItem } from "../motion/page";
import { m } from "../paraglide/messages.js";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContentSkeleton } from "../ui/skeleton";
import { controlClass, Field, statusTone } from "./fields";

const types = ["http", "tcp", "dns", "ssl", "heartbeat"] as const;

function typeLabel(type: string) {
  if (type === "http") return m.monitor_type_http();
  if (type === "tcp") return m.monitor_type_tcp();
  if (type === "dns") return m.monitor_type_dns();
  if (type === "ssl") return m.monitor_type_ssl();
  return m.monitor_type_heartbeat();
}

function statusLabel(status: string) {
  if (status === "up") return m.status_up();
  if (status === "down") return m.status_down();
  if (status === "pending") return m.status_pending();
  if (status === "paused") return m.status_paused();
  return m.status_unknown();
}

export function DashboardPage() {
  const monitors = useQuery(monitorsQuery);
  const rows = monitors.data?.monitors ?? [];
  return (
    <>
      <AppHeader
        title={m.nav_dashboard()}
        actions={
          <Link to="/console/monitors/new">
            <Button>{m.monitor_new()}</Button>
          </Link>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {m.monitors_count({ count: rows.length })}
      </p>
      {monitors.isPending ? (
        <ContentSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          action={
            <Link to="/console/monitors/new">
              <Button>{m.monitor_new()}</Button>
            </Link>
          }
        />
      ) : (
        <Stagger className="grid gap-3">
          {rows.map((row) => (
            <StaggerItem key={row.id}>
              <Link
                to="/console/monitors/$id"
                params={{ id: row.id }}
                className="block"
              >
                <Card>
                  <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{row.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {typeLabel(row.type)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span>
                        {row.uptime24 === null ? "—" : `${row.uptime24}%`}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {row.lastResponseMs ?? "—"} ms
                      </span>
                      <Badge tone={statusTone(row.status)}>
                        {statusLabel(row.status)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
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
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ["monitors"] });
      if (data.pushUrl) setPushUrl(data.pushUrl);
      else navigate({ to: "/console/monitors/$id", params: { id: data.id } });
    },
    onError: (cause) => setError(errorText(cause)),
  });
  return (
    <>
      <AppHeader title={m.monitor_new()} />
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
        <Field label={m.monitor_name()}>
          <Input
            name="name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            required
          />
        </Field>
        <Field label={m.monitor_type()}>
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
          <Field label={m.monitor_url()}>
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
          <Field label={m.monitor_host()}>
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
          <Field label={m.monitor_port()}>
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
            <Field label={m.monitor_dns_name()}>
              <Input
                name="dnsName"
                value={draft.dnsName}
                onChange={(event) =>
                  setDraft({ ...draft, dnsName: event.target.value })
                }
              />
            </Field>
            <Field label={m.monitor_dns_type()}>
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
            <Field label={m.monitor_dns_expected()}>
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
            <Field label={m.monitor_ssl_warn()}>
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
              {m.monitor_ssl_estimate()}
            </p>
          </>
        ) : null}
        {draft.type === "heartbeat" ? (
          <Field label={m.monitor_interval()}>
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
        <Field label={m.monitor_interval()}>
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
        <Field label={m.monitor_retries()}>
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
            <p className="font-medium">{m.monitor_push_url()}</p>
            <p className="mt-1 break-all font-mono text-xs">{pushUrl}</p>
            <p className="mt-2 text-muted-foreground">
              {m.monitor_push_hint()}
            </p>
          </div>
        ) : (
          <PendingButton type="submit" pending={submit.pending}>
            {m.action_create()}
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
  const pause = useMutation({
    mutationFn: async () => {
      if (!row) return;
      await api(`/api/monitors/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: row.name,
          type: row.type,
          config: row.config,
          intervalSeconds: row.intervalSeconds,
          timeoutSeconds: row.timeoutSeconds,
          retries: row.retries,
          recoveryThreshold: row.recoveryThreshold,
          channelIds: row.channelIds,
          paused: !row.paused,
        }),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["monitor", id] });
      void client.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (monitor.isPending) return <ContentSkeleton />;
  if (!row) return <p>{m.loading()}</p>;
  const recent = stats.data?.recent ?? [];
  return (
    <>
      <AppHeader
        title={row.name}
        actions={
          <>
            <PendingButton
              variant="outline"
              type="button"
              pending={action.pending}
              onClick={() => {
                void action.run(async () => {
                  try {
                    await pause.mutateAsync();
                  } catch {
                    // The detail query stays on the last successful row.
                  }
                });
              }}
            >
              {row.paused ? m.action_resume() : m.action_pause()}
            </PendingButton>
            <PendingButton
              variant="destructive"
              type="button"
              pending={action.pending}
              onClick={() => setConfirmDelete(true)}
            >
              {m.action_delete()}
            </PendingButton>
            <ConfirmDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title={m.action_delete()}
              description={m.monitor_delete_confirm()}
              confirmLabel={m.action_delete()}
              cancelLabel={m.action_cancel()}
              pending={action.pending}
              onConfirm={() => {
                void action.run(async () => {
                  await api(`/api/monitors/${id}`, { method: "DELETE" });
                  await client.invalidateQueries({ queryKey: ["monitors"] });
                  setConfirmDelete(false);
                  await navigate({ to: "/console" });
                });
              }}
            />
          </>
        }
      />
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
          {m.monitor_push_url()}: {row.pushUrl}
        </p>
      ) : null}
      <Stagger className="mb-4 grid gap-3 sm:grid-cols-4">
        {(["h24", "d7", "d30", "d90"] as const).map((key) => (
          <StaggerItem key={key}>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  {key === "h24"
                    ? m.range_24h()
                    : key === "d7"
                      ? m.range_7d()
                      : key === "d30"
                        ? m.range_30d()
                        : m.range_90d()}
                </p>
                <p className="text-2xl font-medium">
                  {stats.data?.uptime[key] ?? "—"}%
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="mb-2 text-sm text-muted-foreground">
            {m.chart_response()} · p95 {stats.data?.p95 ?? 0} ms
          </p>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.chart_empty()}</p>
          ) : (
            <div className="h-48 min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={recent.map((point) => ({
                    ...point,
                    label: new Date(point.t).toISOString().slice(11, 19),
                  }))}
                >
                  <XAxis dataKey="label" hide />
                  <YAxis width={32} />
                  <Tooltip />
                  <Area
                    dataKey="ms"
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
            aria-label={m.chart_recent()}
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
      <h2 className="mb-2 font-medium">{m.monitor_outages()}</h2>
      {(outages.data?.outages.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.monitor_no_outages()}
        </p>
      ) : null}
      {outages.isPending ? <ContentSkeleton /> : null}
      <Stagger className="grid gap-2">
        {outages.data?.outages.map((outage) => (
          <StaggerItem key={outage.id}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span>{outage.cause || m.outage_cause()}</span>
              <span className="text-muted-foreground">
                {outage.endedAt
                  ? new Date(outage.endedAt).toISOString()
                  : m.outage_ongoing()}
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
                      await client.invalidateQueries({
                        queryKey: ["outages", id],
                      });
                    });
                  }}
                >
                  {m.monitor_ack()}
                </PendingButton>
              ) : null}
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  );
}
