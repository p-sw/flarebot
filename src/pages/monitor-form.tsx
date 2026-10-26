// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { t } from "@shared/copy";
import {
  blankMonitorDraft,
  dnsRecordTypes,
  draftFromMonitor,
  isSensitiveHeader,
  type MonitorDraft,
  type MonitorErrorCode,
  monitorFieldErrors,
  monitorMethods,
  monitorPayload,
} from "@shared/monitor-draft";
import { monitorTypeSchema } from "@shared/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useBlocker,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import {
  channelsQuery,
  type MonitorDetail,
  monitorQuery,
} from "../lib/queries";
import { commitMonitor, refreshQueries } from "../lib/query-sync";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Stagger, StaggerItem } from "../motion/page";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { ContentSkeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ChannelAttachList } from "./channels";
import { controlClass, Field } from "./fields";
import { monitorTypeLabel } from "./monitor-labels";

const types = monitorTypeSchema.options;

export function MonitorFormPage() {
  return <MonitorForm mode="create" />;
}

export function MonitorEditPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const monitor = useQuery(monitorQuery(id));
  if (monitor.isPending) return <ContentSkeleton />;
  if (!monitor.data) return <p>{t("error_monitor_not_found")}</p>;
  return <MonitorForm mode="edit" monitor={monitor.data} />;
}

function MonitorForm({
  mode,
  monitor,
}: {
  mode: "create" | "edit";
  monitor?: MonitorDetail;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const channels = useQuery(channelsQuery);
  const submit = useSubmitGuard();
  const skip = useRef(false);
  const initial =
    mode === "edit" && monitor
      ? draftFromMonitor(monitor)
      : blankMonitorDraft();
  const [snapshot, setSnapshot] = useState(() => ({
    draft: initial,
    baseline: JSON.stringify(initial),
  }));
  const [errors, setErrors] = useState<
    Partial<Record<keyof MonitorDraft, MonitorErrorCode>>
  >({});
  const [formError, setFormError] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [shownHeaders, setShownHeaders] = useState<Record<string, boolean>>({});
  const draft = snapshot.draft;
  const dirty = JSON.stringify(draft) !== snapshot.baseline;
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !skip.current && !pushUrl,
    withResolver: true,
    enableBeforeUnload: () => dirty && !skip.current && !pushUrl,
  });

  function setDraft(next: MonitorDraft) {
    setSnapshot((current) => ({ ...current, draft: next }));
    setFormError("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = monitorFieldErrors(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(t("monitor_generic_invalid"));
      return;
    }
    setFormError("");
    await submit.run(async () => {
      try {
        const payload = monitorPayload(draft);
        if (mode === "create") {
          const created = await api<{ id: string; pushUrl?: string }>(
            "/api/monitors",
            { method: "POST", body: JSON.stringify(payload) },
          );
          await refreshQueries(client, [["monitors"], ["public"]]);
          if (created.pushUrl) {
            skip.current = true;
            setPushUrl(created.pushUrl);
            setCreatedId(created.id);
            return;
          }
          skip.current = true;
          await navigate({
            to: "/console/monitors/$id",
            params: { id: created.id },
            search: { saved: 1 },
          });
          return;
        }
        if (!monitor) return;
        const saved = await api<MonitorDetail>(`/api/monitors/${monitor.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        skip.current = true;
        commitMonitor(client, saved);
        await refreshQueries(client, [
          ["monitors"],
          ["monitor", monitor.id],
          ["public"],
        ]);
        await navigate({
          to: "/console/monitors/$id",
          params: { id: monitor.id },
          search: { saved: 1 },
        });
      } catch (cause) {
        setFormError(errorText(cause));
      }
    });
  }

  return (
    <>
      <AppHeader
        title={mode === "create" ? t("monitor_new") : t("monitor_edit")}
      />
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        {mode === "create"
          ? t("monitor_create_intro")
          : t("monitor_edit_intro")}
      </p>
      <form className="grid min-w-0 max-w-2xl gap-4" onSubmit={onSubmit}>
        <Stagger className="grid gap-4">
          <StaggerItem>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t("monitor_record")}</CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3">
                <Field
                  label={t("monitor_name")}
                  hint={t("monitor_name_hint")}
                  error={fieldErrorText(errors.name)}
                >
                  <Input
                    name="name"
                    value={draft.name}
                    aria-invalid={Boolean(errors.name)}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </Field>
                <Field label={t("monitor_type")} hint={t("monitor_type_hint")}>
                  <select
                    className={controlClass}
                    name="type"
                    value={draft.type}
                    onChange={(event) => {
                      const parsed = monitorTypeSchema.safeParse(
                        event.target.value,
                      );
                      if (!parsed.success) return;
                      setDraft({ ...draft, type: parsed.data });
                    }}
                  >
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {monitorTypeLabel(type)}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.paused ? (
                  <p className="text-sm text-muted-foreground">
                    {t("monitor_edit_stays_paused")}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t("monitor_check")}</CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3">
                {draft.type === "http" ? (
                  <HttpFields
                    draft={draft}
                    errors={errors}
                    shownHeaders={shownHeaders}
                    onShowHeader={(id, shown) =>
                      setShownHeaders((current) => ({
                        ...current,
                        [id]: shown,
                      }))
                    }
                    onChange={setDraft}
                  />
                ) : null}
                {draft.type === "tcp" ? (
                  <TcpFields
                    draft={draft}
                    errors={errors}
                    onChange={setDraft}
                  />
                ) : null}
                {draft.type === "dns" ? (
                  <DnsFields
                    draft={draft}
                    errors={errors}
                    onChange={setDraft}
                  />
                ) : null}
                {draft.type === "ssl" ? (
                  <SslFields
                    draft={draft}
                    errors={errors}
                    onChange={setDraft}
                  />
                ) : null}
                {draft.type === "heartbeat" ? (
                  <Field
                    label={t("monitor_grace")}
                    hint={t("monitor_grace_hint")}
                    error={fieldErrorText(errors.graceSeconds)}
                  >
                    <Input
                      name="grace"
                      type="number"
                      min={0}
                      value={draft.graceSeconds}
                      aria-invalid={Boolean(errors.graceSeconds)}
                      onChange={(event) =>
                        setDraft({ ...draft, graceSeconds: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t("monitor_timing")}</CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3">
                <p className="text-xs text-muted-foreground">
                  {t("monitor_schedule")}
                </p>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <Field
                    label={t("monitor_interval")}
                    hint={t("monitor_interval_hint")}
                    error={fieldErrorText(errors.intervalSeconds)}
                  >
                    <Input
                      name="interval"
                      type="number"
                      min={60}
                      value={draft.intervalSeconds}
                      aria-invalid={Boolean(errors.intervalSeconds)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          intervalSeconds: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label={t("monitor_timeout")}
                    hint={t("monitor_timeout_hint")}
                    error={fieldErrorText(errors.timeoutSeconds)}
                  >
                    <Input
                      name="timeout"
                      type="number"
                      min={1}
                      value={draft.timeoutSeconds}
                      aria-invalid={Boolean(errors.timeoutSeconds)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          timeoutSeconds: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label={t("monitor_retries")}
                    hint={t("monitor_retries_hint")}
                    error={fieldErrorText(errors.retries)}
                  >
                    <Input
                      name="retries"
                      type="number"
                      min={1}
                      value={draft.retries}
                      aria-invalid={Boolean(errors.retries)}
                      onChange={(event) =>
                        setDraft({ ...draft, retries: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label={t("monitor_recovery")}
                    hint={t("monitor_recovery_hint")}
                    error={fieldErrorText(errors.recoveryThreshold)}
                  >
                    <Input
                      name="recovery"
                      type="number"
                      min={1}
                      value={draft.recoveryThreshold}
                      aria-invalid={Boolean(errors.recoveryThreshold)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recoveryThreshold: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>{t("monitor_channels")}</CardTitle>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3">
                <p className="text-xs text-muted-foreground">
                  {t("monitor_channels_hint")}
                </p>
                {fieldErrorText(errors.channelIds) ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fieldErrorText(errors.channelIds)}
                  </p>
                ) : null}
                {(channels.data?.channels.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("monitor_no_channels")}
                  </p>
                ) : (
                  <ChannelAttachList
                    channels={channels.data?.channels ?? []}
                    selected={draft.channelIds}
                    onChange={(channelIds) =>
                      setDraft({ ...draft, channelIds })
                    }
                  />
                )}
              </CardContent>
            </Card>
          </StaggerItem>
        </Stagger>
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        {pushUrl ? (
          <div className="min-w-0 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{t("monitor_push_url")}</p>
            <p
              className="mt-1 max-w-full min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs"
              title={pushUrl}
            >
              {pushUrl}
            </p>
            <p className="mt-2 text-muted-foreground">
              {t("monitor_push_hint")}
            </p>
            {createdId ? (
              <Link
                to="/console/monitors/$id"
                params={{ id: createdId }}
                className="mt-3 inline-block text-sm underline-offset-2 hover:underline"
              >
                {t("monitor_open")}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {mode === "edit"
                ? dirty
                  ? t("page_unsaved")
                  : t("page_saved_clean")
                : null}
            </p>
            <Button
              type="submit"
              disabled={submit.pending || (mode === "edit" && !dirty)}
              aria-busy={submit.pending || undefined}
            >
              {submit.pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {submit.pending
                ? t("action_working")
                : mode === "create"
                  ? t("action_create")
                  : t("action_save")}
            </Button>
          </div>
        )}
      </form>
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
        title={t("monitor_leave_title")}
        description={t("monitor_leave_body")}
        confirmLabel={t("monitor_leave_confirm")}
        cancelLabel={t("monitor_leave_stay")}
        onConfirm={() => {
          if (blocker.status === "blocked") blocker.proceed();
        }}
      />
    </>
  );
}

function HttpFields({
  draft,
  errors,
  shownHeaders,
  onShowHeader,
  onChange,
}: {
  draft: MonitorDraft;
  errors: Partial<Record<keyof MonitorDraft, MonitorErrorCode>>;
  shownHeaders: Record<string, boolean>;
  onShowHeader: (id: string, shown: boolean) => void;
  onChange: (draft: MonitorDraft) => void;
}) {
  return (
    <>
      <Field
        label={t("monitor_url")}
        hint={t("monitor_url_hint")}
        error={fieldErrorText(errors.url)}
      >
        <Input
          name="url"
          value={draft.url}
          aria-invalid={Boolean(errors.url)}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
        />
      </Field>
      <Field label={t("monitor_method")} hint={t("monitor_method_hint")}>
        <select
          className={controlClass}
          name="method"
          value={draft.method}
          onChange={(event) => {
            const method = monitorMethods.find(
              (item) => item === event.target.value,
            );
            if (!method) return;
            onChange({ ...draft, method });
          }}
        >
          {monitorMethods.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={t("monitor_expected_status")}
        hint={t("monitor_statuses_hint")}
        error={fieldErrorText(errors.expectedStatuses)}
      >
        <Input
          name="statuses"
          value={draft.expectedStatuses}
          aria-invalid={Boolean(errors.expectedStatuses)}
          onChange={(event) =>
            onChange({ ...draft, expectedStatuses: event.target.value })
          }
        />
      </Field>
      <Field
        label={t("monitor_keyword")}
        hint={t("monitor_keyword_hint")}
        error={fieldErrorText(errors.keyword)}
      >
        <Input
          name="keyword"
          value={draft.keyword}
          aria-invalid={Boolean(errors.keyword)}
          onChange={(event) =>
            onChange({ ...draft, keyword: event.target.value })
          }
        />
      </Field>
      <Field label={t("monitor_keyword_mode")}>
        <select
          className={controlClass}
          name="keywordMode"
          value={draft.keywordMode}
          onChange={(event) =>
            onChange({
              ...draft,
              keywordMode:
                event.target.value === "absent" ? "absent" : "present",
            })
          }
        >
          <option value="present">{t("monitor_keyword_present")}</option>
          <option value="absent">{t("monitor_keyword_absent")}</option>
        </select>
      </Field>
      <Field
        label={t("monitor_json_path")}
        hint={t("monitor_json_hint")}
        error={
          fieldErrorText(errors.jsonPath) ?? fieldErrorText(errors.jsonExpect)
        }
      >
        <Input
          name="jsonPath"
          value={draft.jsonPath}
          aria-invalid={Boolean(errors.jsonPath || errors.jsonExpect)}
          onChange={(event) =>
            onChange({ ...draft, jsonPath: event.target.value })
          }
        />
      </Field>
      <Field
        label={t("monitor_json_expect")}
        error={fieldErrorText(errors.jsonExpect)}
      >
        <Input
          name="jsonExpect"
          value={draft.jsonExpect}
          aria-invalid={Boolean(errors.jsonExpect)}
          onChange={(event) =>
            onChange({ ...draft, jsonExpect: event.target.value })
          }
        />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("monitor_follow")}</p>
          <p className="text-xs text-muted-foreground">
            {t("monitor_follow_hint")}
          </p>
        </div>
        <Switch
          checked={draft.followRedirects}
          onCheckedChange={(checked) =>
            onChange({ ...draft, followRedirects: checked })
          }
          aria-label={t("monitor_follow")}
        />
      </div>
      <div className="grid min-w-0 gap-2">
        <div>
          <p className="text-sm font-medium">{t("monitor_headers")}</p>
          <p className="text-xs text-muted-foreground">
            {t("monitor_headers_hint")}
          </p>
        </div>
        {fieldErrorText(errors.headers) ? (
          <p role="alert" className="text-xs text-destructive">
            {fieldErrorText(errors.headers)}
          </p>
        ) : null}
        {draft.headers.map((header) => {
          const sensitive = isSensitiveHeader(header.name);
          const shown = shownHeaders[header.id] === true;
          return (
            <div key={header.id} className="grid min-w-0 gap-2 sm:grid-cols-2">
              <Field label={t("monitor_header_name")}>
                <Input
                  value={header.name}
                  autoComplete="off"
                  onChange={(event) => {
                    const headers = draft.headers.map((row) =>
                      row.id === header.id
                        ? { ...row, name: event.target.value }
                        : row,
                    );
                    onChange({ ...draft, headers });
                  }}
                />
              </Field>
              <Field label={t("monitor_header_value")}>
                <Input
                  type={sensitive && !shown ? "password" : "text"}
                  value={header.value}
                  autoComplete="off"
                  onChange={(event) => {
                    const headers = draft.headers.map((row) =>
                      row.id === header.id
                        ? { ...row, value: event.target.value }
                        : row,
                    );
                    onChange({ ...draft, headers });
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {sensitive ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onShowHeader(header.id, !shown)}
                  >
                    {shown ? t("monitor_hide") : t("monitor_reveal")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onChange({
                      ...draft,
                      headers: draft.headers.filter(
                        (row) => row.id !== header.id,
                      ),
                    })
                  }
                >
                  {t("monitor_header_remove")}
                </Button>
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({
              ...draft,
              headers: [
                ...draft.headers,
                { id: crypto.randomUUID(), name: "", value: "" },
              ],
            })
          }
        >
          {t("monitor_header_add")}
        </Button>
      </div>
      <Field
        label={t("monitor_body")}
        hint={t("monitor_body_hint")}
        error={fieldErrorText(errors.body)}
      >
        <Textarea
          name="body"
          value={draft.body}
          aria-invalid={Boolean(errors.body)}
          onChange={(event) => onChange({ ...draft, body: event.target.value })}
        />
      </Field>
    </>
  );
}

function TcpFields({
  draft,
  errors,
  onChange,
}: {
  draft: MonitorDraft;
  errors: Partial<Record<keyof MonitorDraft, MonitorErrorCode>>;
  onChange: (draft: MonitorDraft) => void;
}) {
  return (
    <>
      <Field
        label={t("monitor_host")}
        hint={t("monitor_host_hint")}
        error={fieldErrorText(errors.host)}
      >
        <Input
          name="host"
          value={draft.host}
          aria-invalid={Boolean(errors.host)}
          onChange={(event) => onChange({ ...draft, host: event.target.value })}
        />
      </Field>
      <Field
        label={t("monitor_port")}
        hint={t("monitor_port_hint")}
        error={fieldErrorText(errors.port)}
      >
        <Input
          name="port"
          type="number"
          min={1}
          value={draft.port}
          aria-invalid={Boolean(errors.port)}
          onChange={(event) => onChange({ ...draft, port: event.target.value })}
        />
      </Field>
    </>
  );
}

function DnsFields({
  draft,
  errors,
  onChange,
}: {
  draft: MonitorDraft;
  errors: Partial<Record<keyof MonitorDraft, MonitorErrorCode>>;
  onChange: (draft: MonitorDraft) => void;
}) {
  return (
    <>
      <Field
        label={t("monitor_dns_name")}
        hint={t("monitor_dns_name_hint")}
        error={fieldErrorText(errors.dnsName)}
      >
        <Input
          name="dnsName"
          value={draft.dnsName}
          aria-invalid={Boolean(errors.dnsName)}
          onChange={(event) =>
            onChange({ ...draft, dnsName: event.target.value })
          }
        />
      </Field>
      <Field label={t("monitor_dns_type")} hint={t("monitor_dns_type_hint")}>
        <select
          className={controlClass}
          name="dnsType"
          value={draft.dnsType}
          onChange={(event) => {
            const dnsType = dnsRecordTypes.find(
              (item) => item === event.target.value,
            );
            if (!dnsType) return;
            onChange({ ...draft, dnsType });
          }}
        >
          {dnsRecordTypes.map((dnsType) => (
            <option key={dnsType} value={dnsType}>
              {dnsType}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={t("monitor_dns_expected")}
        hint={t("monitor_dns_expected_hint")}
        error={fieldErrorText(errors.expected)}
      >
        <Input
          name="expected"
          value={draft.expected}
          aria-invalid={Boolean(errors.expected)}
          onChange={(event) =>
            onChange({ ...draft, expected: event.target.value })
          }
        />
      </Field>
      <Field
        label={t("monitor_resolver")}
        hint={t("monitor_resolver_hint")}
        error={fieldErrorText(errors.resolver)}
      >
        <Input
          name="resolver"
          value={draft.resolver}
          aria-invalid={Boolean(errors.resolver)}
          onChange={(event) =>
            onChange({ ...draft, resolver: event.target.value })
          }
        />
      </Field>
    </>
  );
}

function SslFields({
  draft,
  errors,
  onChange,
}: {
  draft: MonitorDraft;
  errors: Partial<Record<keyof MonitorDraft, MonitorErrorCode>>;
  onChange: (draft: MonitorDraft) => void;
}) {
  return (
    <>
      <Field
        label={t("monitor_host")}
        hint={t("monitor_host_hint")}
        error={fieldErrorText(errors.host)}
      >
        <Input
          name="host"
          value={draft.host}
          aria-invalid={Boolean(errors.host)}
          onChange={(event) => onChange({ ...draft, host: event.target.value })}
        />
      </Field>
      <Field
        label={t("monitor_ssl_warn")}
        hint={t("monitor_warn_hint")}
        error={fieldErrorText(errors.warnDays)}
      >
        <Input
          name="warnDays"
          type="number"
          min={1}
          value={draft.warnDays}
          aria-invalid={Boolean(errors.warnDays)}
          onChange={(event) =>
            onChange({ ...draft, warnDays: event.target.value })
          }
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {t("monitor_ssl_estimate")}
      </p>
    </>
  );
}

function fieldErrorText(
  code: MonitorErrorCode | undefined,
): string | undefined {
  switch (code) {
    case "name":
      return t("monitor_name_invalid");
    case "interval":
      return t("monitor_interval_invalid");
    case "timeout":
      return t("monitor_timeout_invalid");
    case "retries":
      return t("monitor_retries_invalid");
    case "recovery":
      return t("monitor_recovery_invalid");
    case "url":
      return t("monitor_url_invalid");
    case "url_blocked":
      return t("monitor_url_blocked");
    case "host":
      return t("monitor_host_invalid");
    case "host_private":
      return t("monitor_host_private");
    case "port":
      return t("monitor_port_invalid");
    case "port_blocked":
      return t("monitor_port_blocked");
    case "dns_name":
      return t("monitor_dns_name_invalid");
    case "dns_expected":
      return t("monitor_dns_expected_invalid");
    case "resolver":
      return t("monitor_resolver_invalid");
    case "warn":
      return t("monitor_warn_invalid");
    case "grace":
      return t("monitor_grace_invalid");
    case "headers":
      return t("monitor_headers_invalid");
    case "statuses":
      return t("monitor_statuses_invalid");
    case "keyword":
      return t("monitor_keyword_invalid");
    case "json":
      return t("monitor_json_invalid");
    case "body":
      return t("monitor_body_invalid");
    case "channels":
      return t("monitor_channels_invalid");
    case "generic":
      return t("monitor_generic_invalid");
    default:
      return undefined;
  }
}
