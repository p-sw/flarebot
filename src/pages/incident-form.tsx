// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { formatDateTime, t } from "@shared/copy";
import type { Impact, IncidentStatus } from "@shared/impact";
import { can } from "@shared/permissions";
import { formatLocalInput, parseLocalInput } from "@shared/recurrence";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { Textarea } from "@/ui/textarea";
import { api, errorText } from "../lib/api";
import {
  channelsQuery,
  incidentQuery,
  monitorsQuery,
  statusPagesQuery,
} from "../lib/queries";
import { refreshQueries } from "../lib/query-sync";
import { useRole } from "../lib/use-role";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContentSkeleton } from "../ui/skeleton";
import {
  incidentStatusLabel,
  MonitorImpacts,
  NotifyFields,
} from "./announcement-fields";
import { controlClass, Field, GroupField } from "./fields";
import { Markdown } from "./markdown";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function localValue(ms: number): string {
  try {
    return formatLocalInput(ms, zone);
  } catch {
    return formatLocalInput(ms, "UTC");
  }
}

function parseLocal(value: string): number | null {
  return parseLocalInput(value, zone) ?? parseLocalInput(value, "UTC");
}

export function IncidentCreatePage() {
  return <IncidentEditor />;
}

export function IncidentEditPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  return <IncidentEditor id={id} />;
}

function IncidentEditor({ id }: { id?: string }) {
  const existing = useQuery({
    ...incidentQuery(id ?? "new"),
    enabled: Boolean(id),
  });
  if (id && !existing.data) {
    return existing.isError ? (
      <p className="text-sm text-destructive">{t("error_not_found")}</p>
    ) : (
      <ContentSkeleton />
    );
  }
  return (
    <IncidentEditorForm
      key={existing.data?.updatedAt ?? "new"}
      id={id}
      initial={existing.data}
    />
  );
}

function IncidentEditorForm({
  id,
  initial,
}: {
  id?: string;
  initial?: {
    title: string;
    notify: boolean;
    monitors: { monitorId: string; impact: string }[];
    pages: { pageId: string }[];
    channels: { channelId: string }[];
    updates: {
      id: string;
      status: string;
      body: string;
      postedAt: number;
    }[];
    resolvedAt: number | null;
  };
}) {
  const role = useRole();
  const writable = role ? can({ role }, "incidents.write") : false;
  const navigate = useNavigate();
  const client = useQueryClient();
  const monitors = useQuery(monitorsQuery);
  const pages = useQuery(statusPagesQuery);
  const channels = useQuery(channelsQuery);
  const save = useSubmitGuard();
  const extra = useSubmitGuard();
  const [error, setError] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notify, setNotify] = useState(initial?.notify ?? false);
  const [pageIds, setPageIds] = useState(
    initial?.pages.map((page) => page.pageId) ?? [],
  );
  const [channelIds, setChannelIds] = useState(
    initial?.channels.map((channel) => channel.channelId) ?? [],
  );
  const [selected, setSelected] = useState(
    initial?.monitors.map((monitor) => ({
      monitorId: monitor.monitorId,
      impact: monitor.impact as Impact,
    })) ?? [],
  );
  const [status, setStatus] = useState<IncidentStatus>("investigating");
  const [body, setBody] = useState("");
  const [postedAt, setPostedAt] = useState(localValue(Date.now()));
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveBody, setResolveBody] = useState("");

  async function refresh() {
    await refreshQueries(client, [["incidents"], ["incident", id ?? ""]]);
  }

  function payload(update?: {
    status: IncidentStatus;
    body: string;
    postedAt: number;
  }) {
    return {
      title: title.trim(),
      notify,
      channelIds,
      pageIds,
      monitors: selected,
      update,
    };
  }

  return (
    <div className="min-w-0">
      <AppHeader
        title={id ? t("incident_edit") : t("incident_new")}
        actions={
          <Button asChild variant="outline">
            <Link to="/console/incidents">{t("incident_back")}</Link>
          </Button>
        }
      />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const when = parseLocal(postedAt);
          if (!id && (!when || !body.trim() || selected.length === 0)) {
            setError(t("error_validation"));
            return;
          }
          void save.run(async () => {
            try {
              if (!id) {
                const created = await api<{ id: string }>("/api/incidents", {
                  method: "POST",
                  body: JSON.stringify(
                    payload({
                      status,
                      body: body.trim(),
                      postedAt: when ?? Date.now(),
                    }),
                  ),
                });
                await refresh();
                await navigate({
                  to: "/console/incidents/$id",
                  params: { id: created.id },
                });
                return;
              }
              await api(`/api/incidents/${id}`, {
                method: "PATCH",
                body: JSON.stringify(payload()),
              });
              await refresh();
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("incident_details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label={t("incident_name")} hint={t("incident_name_hint")}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                disabled={!writable}
              />
            </Field>
            <GroupField
              label={t("incident_monitors")}
              hint={t("incident_monitors_hint")}
            >
              <MonitorImpacts
                options={(monitors.data?.monitors ?? []).map((monitor) => ({
                  id: monitor.id,
                  label: monitor.name,
                }))}
                value={selected}
                onChange={setSelected}
              />
            </GroupField>
            <GroupField
              label={t("incident_pages")}
              hint={t("incident_pages_hint")}
            >
              <div className="grid gap-2">
                {(pages.data?.pages ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("incident_pages_empty")}
                  </p>
                ) : (
                  pages.data?.pages.map((page) => {
                    const checked = pageIds.includes(page.id);
                    return (
                      <label
                        key={page.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          disabled={!writable}
                          onChange={() =>
                            setPageIds(
                              checked
                                ? pageIds.filter((item) => item !== page.id)
                                : [...pageIds, page.id],
                            )
                          }
                        />
                        <span className="min-w-0 break-words">
                          {page.title}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </GroupField>
            <NotifyFields
              notify={notify}
              onNotify={setNotify}
              channels={(channels.data?.channels ?? []).map((channel) => ({
                id: channel.id,
                label: channel.name,
              }))}
              channelIds={channelIds}
              onChannels={setChannelIds}
            />
          </CardContent>
        </Card>
        {!id ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("incident_first_update")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <UpdateFields
                status={status}
                body={body}
                postedAt={postedAt}
                onStatus={setStatus}
                onBody={setBody}
                onPostedAt={setPostedAt}
              />
            </CardContent>
          </Card>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {writable ? (
          <PendingButton type="submit" pending={save.pending}>
            {id ? t("action_save") : t("action_create")}
          </PendingButton>
        ) : null}
      </form>
      {id && initial ? (
        <div className="mt-6 grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("incident_timeline")}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("incident_timeline_hint")}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              {initial.updates.map((update) => (
                <article
                  key={update.id}
                  className="min-w-0 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {incidentStatusLabel(update.status)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(update.postedAt)}
                    </p>
                  </div>
                  {editing === update.id ? (
                    <UpdateEditor
                      incidentId={id}
                      update={update}
                      pending={extra.pending}
                      onClose={() => setEditing(null)}
                      onError={setError}
                      onSaved={async () => {
                        setEditing(null);
                        await refresh();
                      }}
                    />
                  ) : (
                    <>
                      <div className="mt-2">
                        <Markdown source={update.body} />
                      </div>
                      {writable ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(update.id)}
                          >
                            {t("action_edit")}
                          </Button>
                          <PendingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            pending={
                              extra.pending && editing === `delete-${update.id}`
                            }
                            onClick={() => {
                              setEditing(`delete-${update.id}`);
                              void extra.run(async () => {
                                try {
                                  await api(
                                    `/api/incidents/${id}/updates/${update.id}`,
                                    { method: "DELETE" },
                                  );
                                  await refresh();
                                } catch (cause) {
                                  setError(errorText(cause));
                                } finally {
                                  setEditing(null);
                                }
                              });
                            }}
                          >
                            {t("action_delete")}
                          </PendingButton>
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              ))}
              {writable ? (
                <form
                  className="grid gap-3 border-t border-border pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const when = parseLocal(postedAt);
                    if (!when || !body.trim()) {
                      setError(t("error_validation"));
                      return;
                    }
                    setError("");
                    void extra.run(async () => {
                      try {
                        await api(`/api/incidents/${id}/updates`, {
                          method: "POST",
                          body: JSON.stringify({
                            status,
                            body: body.trim(),
                            postedAt: when,
                          }),
                        });
                        setBody("");
                        await refresh();
                      } catch (cause) {
                        setError(errorText(cause));
                      }
                    });
                  }}
                >
                  <h3 className="text-sm font-medium">
                    {t("incident_update_add")}
                  </h3>
                  <UpdateFields
                    status={status}
                    body={body}
                    postedAt={postedAt}
                    onStatus={setStatus}
                    onBody={setBody}
                    onPostedAt={setPostedAt}
                  />
                  <PendingButton type="submit" pending={extra.pending}>
                    {t("incident_update_add")}
                  </PendingButton>
                </form>
              ) : null}
            </CardContent>
          </Card>
          {writable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResolveOpen(true)}
              >
                {t("incident_resolve")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                {t("incident_delete")}
              </Button>
            </div>
          ) : null}
          {resolveOpen ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("incident_resolve")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Field
                  label={t("incident_update_message")}
                  hint={t("incident_resolve_hint")}
                >
                  <Textarea
                    value={resolveBody}
                    onChange={(event) => setResolveBody(event.target.value)}
                  />
                </Field>
                <PendingButton
                  type="button"
                  pending={extra.pending}
                  onClick={() => {
                    if (!resolveBody.trim()) {
                      setError(t("error_validation"));
                      return;
                    }
                    void extra.run(async () => {
                      try {
                        await api(`/api/incidents/${id}/resolve`, {
                          method: "POST",
                          body: JSON.stringify({ body: resolveBody.trim() }),
                        });
                        setResolveOpen(false);
                        setResolveBody("");
                        await refresh();
                      } catch (cause) {
                        setError(errorText(cause));
                      }
                    });
                  }}
                >
                  {t("incident_resolve")}
                </PendingButton>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("incident_delete_title")}
        description={t("incident_delete_body")}
        confirmLabel={t("action_delete")}
        cancelLabel={t("action_cancel")}
        pending={extra.pending}
        onConfirm={() => {
          if (!id) return;
          void extra.run(async () => {
            try {
              await api(`/api/incidents/${id}`, { method: "DELETE" });
              await refresh();
              setConfirmDelete(false);
              await navigate({ to: "/console/incidents" });
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      />
    </div>
  );
}

function UpdateFields({
  status,
  body,
  postedAt,
  onStatus,
  onBody,
  onPostedAt,
}: {
  status: IncidentStatus;
  body: string;
  postedAt: string;
  onStatus: (status: IncidentStatus) => void;
  onBody: (value: string) => void;
  onPostedAt: (value: string) => void;
}) {
  return (
    <>
      <Field
        label={t("incident_update_status")}
        hint={t("incident_update_status_hint")}
      >
        <select
          className={controlClass}
          value={status}
          onChange={(event) => onStatus(event.target.value as IncidentStatus)}
        >
          <option value="investigating">
            {t("incident_status_investigating")}
          </option>
          <option value="identified">{t("incident_status_identified")}</option>
          <option value="monitoring">{t("incident_status_monitoring")}</option>
          <option value="resolved">{t("incident_status_resolved")}</option>
        </select>
      </Field>
      <Field
        label={t("incident_update_message")}
        hint={t("incident_update_message_hint")}
      >
        <Textarea
          value={body}
          onChange={(event) => onBody(event.target.value)}
        />
      </Field>
      <Field
        label={t("incident_update_time")}
        hint={t("incident_update_time_hint")}
      >
        <Input
          type="datetime-local"
          value={postedAt}
          onChange={(event) => onPostedAt(event.target.value)}
        />
      </Field>
    </>
  );
}

function UpdateEditor({
  incidentId,
  update,
  pending,
  onClose,
  onSaved,
  onError,
}: {
  incidentId: string;
  update: { id: string; status: string; body: string; postedAt: number };
  pending: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState(update.status as IncidentStatus);
  const [body, setBody] = useState(update.body);
  const [postedAt, setPostedAt] = useState(localValue(update.postedAt));
  const save = useSubmitGuard();
  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const when = parseLocal(postedAt);
        if (!when || !body.trim()) {
          onError(t("error_validation"));
          return;
        }
        void save.run(async () => {
          try {
            await api(`/api/incidents/${incidentId}/updates/${update.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status,
                body: body.trim(),
                postedAt: when,
              }),
            });
            await onSaved();
          } catch (cause) {
            onError(errorText(cause));
          }
        });
      }}
    >
      <UpdateFields
        status={status}
        body={body}
        postedAt={postedAt}
        onStatus={setStatus}
        onBody={setBody}
        onPostedAt={setPostedAt}
      />
      <div className="flex flex-wrap gap-2">
        <PendingButton type="submit" pending={pending || save.pending}>
          {t("incident_update_save")}
        </PendingButton>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("action_cancel")}
        </Button>
      </div>
    </form>
  );
}
