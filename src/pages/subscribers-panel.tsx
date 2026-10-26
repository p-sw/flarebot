// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { can } from "@shared/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { ApiClientError, api, errorText } from "../lib/api";
import { refreshQueries } from "../lib/query-sync";
import { useToggleLock } from "../lib/toggle-guard";
import { useRole } from "../lib/use-role";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { Switch } from "../ui/switch";

type Flags = { email: boolean; webhook: boolean; rss: boolean };

type SubscriberList = {
  subscriptions: Flags;
  mailConfigured: boolean;
  turnstile: "widget" | "rate_limit";
  allowHttp: boolean;
  counts: { pending: number; confirmed: number; disabled: number };
  backlog: number;
  subscribers: {
    id: string;
    kind: string;
    status: string;
    label: string;
    createdAt: number;
    failCount: number;
  }[];
};

function statusLabel(status: string): string {
  if (status === "pending") return t("sub_status_pending");
  if (status === "confirmed") return t("sub_status_confirmed");
  return t("sub_status_disabled");
}

export function SubscribersPanel({ pageId }: { pageId: string }) {
  const role = useRole();
  const writable = role ? can({ role }, "status_pages.write") : false;
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["subscribers", pageId, query, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      const suffix = params.size ? `?${params.toString()}` : "";
      return api<SubscriberList>(
        `/api/status-pages/${pageId}/subscribers${suffix}`,
      );
    },
  });
  if (list.isPending) return null;
  if (!list.data) return null;
  return (
    <section className="mt-10 min-w-0" aria-label={t("page_subscriptions")}>
      <h2 className="text-lg font-medium">{t("page_subscriptions")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        {t("page_subscriptions_hint")}
      </p>
      <FlagRow pageId={pageId} data={list.data} writable={writable} />
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        {list.data.turnstile === "widget"
          ? t("page_sub_turnstile_on")
          : t("page_sub_turnstile_rate")}
      </p>
      {!list.data.mailConfigured ? (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {t("page_sub_email_off")}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label={t("page_sub_pending")} value={list.data.counts.pending} />
        <Stat
          label={t("page_sub_confirmed")}
          value={list.data.counts.confirmed}
        />
        <Stat
          label={t("page_sub_disabled")}
          value={list.data.counts.disabled}
        />
      </dl>
      <p className="mt-3 text-sm">
        {t("page_sub_backlog", { count: list.data.backlog })}
      </p>
      <p className="max-w-2xl text-xs text-muted-foreground">
        {t("page_sub_backlog_hint")}
      </p>
      <form
        className="mt-4 flex min-w-0 flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(q.trim());
        }}
      >
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Input is the control */}
        <label className="grid min-w-0 flex-1 gap-1 text-sm">
          <span className="font-medium">{t("page_sub_search")}</span>
          <Input value={q} onChange={(event) => setQ(event.target.value)} />
          <span className="text-xs text-muted-foreground">
            {t("page_sub_search_hint")}
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t("page_sub_status")}</span>
          <select
            className="h-10 rounded-lg border border-input bg-card px-3"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("page_sub_filter_all")}</option>
            <option value="pending">{t("sub_status_pending")}</option>
            <option value="confirmed">{t("sub_status_confirmed")}</option>
            <option value="disabled">{t("sub_status_disabled")}</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          {t("page_sub_search")}
        </Button>
        <ExportButton pageId={pageId} />
      </form>
      {list.data.subscribers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("page_sub_empty")}
        </p>
      ) : (
        <ul className="mt-4 grid min-w-0 gap-2">
          {list.data.subscribers.map((row) => (
            <SubscriberRow
              key={row.id}
              pageId={pageId}
              row={row}
              writable={writable}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium">{value}</dd>
    </div>
  );
}

function FlagRow({
  pageId,
  data,
  writable,
}: {
  pageId: string;
  data: SubscriberList;
  writable: boolean;
}) {
  const client = useQueryClient();
  const toggles = useToggleLock();
  const [flags, setFlags] = useState<Flags | null>(null);
  const shown = flags ?? data.subscriptions;
  const [error, setError] = useState("");

  async function update(key: keyof Flags, checked: boolean) {
    setError("");
    const next = { ...shown, [key]: checked };
    setFlags(next);
    await toggles.run(key, async () => {
      try {
        const saved = await api<Flags>(
          `/api/status-pages/${pageId}/subscriptions`,
          {
            method: "PUT",
            body: JSON.stringify({ [key]: checked }),
          },
        );
        setFlags(saved);
        await refreshQueries(client, [["subscribers", pageId]]);
      } catch (cause) {
        setFlags(data.subscriptions);
        setError(errorText(cause));
      }
    });
  }

  return (
    <div className="mt-4 grid gap-3">
      <Toggle
        label={t("page_sub_email")}
        hint={t("page_sub_email_hint")}
        checked={shown.email}
        pending={toggles.pendingKey === "email"}
        disabled={!writable || toggles.pending}
        onCheckedChange={(checked) => void update("email", checked)}
      />
      <Toggle
        label={t("page_sub_webhook")}
        hint={t("page_sub_webhook_hint")}
        checked={shown.webhook}
        pending={toggles.pendingKey === "webhook"}
        disabled={!writable || toggles.pending}
        onCheckedChange={(checked) => void update("webhook", checked)}
      />
      <Toggle
        label={t("page_sub_rss")}
        hint={t("page_sub_rss_hint")}
        checked={shown.rss}
        pending={toggles.pendingKey === "rss"}
        disabled={!writable || toggles.pending}
        onCheckedChange={(checked) => void update("rss", checked)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  pending,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
      <label className="flex min-w-0 items-center gap-3 text-sm">
        <Switch
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-busy={pending || undefined}
          onCheckedChange={(next) => {
            if (disabled) return;
            onCheckedChange(next);
          }}
        />
        <span id={labelId} className="min-w-0 font-medium">
          {label}
        </span>
        {pending ? (
          <span role="status" className="inline-flex text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span className="sr-only">{t("page_sub_busy")}</span>
          </span>
        ) : null}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function SubscriberRow({
  pageId,
  row,
  writable,
}: {
  pageId: string;
  row: SubscriberList["subscribers"][number];
  writable: boolean;
}) {
  const client = useQueryClient();
  const remove = useSubmitGuard();
  const [error, setError] = useState("");
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{row.label}</p>
        <p className="text-xs text-muted-foreground">
          {row.kind === "email"
            ? t("subscribe_email")
            : t("subscribe_kind_webhook")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          tone={
            row.status === "confirmed"
              ? "up"
              : row.status === "pending"
                ? "pending"
                : "down"
          }
        >
          {statusLabel(row.status)}
        </Badge>
        {writable ? (
          <PendingButton
            type="button"
            variant="outline"
            size="sm"
            pending={remove.pending}
            onClick={() => {
              setError("");
              void remove.run(async () => {
                try {
                  await api(
                    `/api/status-pages/${pageId}/subscribers/${row.id}`,
                    {
                      method: "DELETE",
                    },
                  );
                  await refreshQueries(client, [["subscribers", pageId]]);
                } catch (cause) {
                  setError(
                    cause instanceof ApiClientError
                      ? cause.message
                      : t("error_generic"),
                  );
                }
              });
            }}
          >
            {t("page_sub_remove")}
          </PendingButton>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ExportButton({ pageId }: { pageId: string }) {
  const submit = useSubmitGuard();
  const [error, setError] = useState("");
  return (
    <div>
      <PendingButton
        type="button"
        variant="outline"
        pending={submit.pending}
        onClick={() => {
          setError("");
          void submit.run(async () => {
            try {
              const response = await fetch(
                `/api/status-pages/${pageId}/subscribers.csv`,
                {
                  credentials: "same-origin",
                },
              );
              if (!response.ok) throw new Error("export");
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "subscribers.csv";
              link.click();
              URL.revokeObjectURL(url);
            } catch {
              setError(t("error_generic"));
            }
          });
        }}
      >
        {t("page_sub_export")}
      </PendingButton>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
