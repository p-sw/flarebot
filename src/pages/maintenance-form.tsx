// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { t, textLang } from "@shared/copy";
import { can } from "@shared/permissions";
import {
  formatLocalInput,
  type MaintenanceSchedule,
  nextOccurrences,
  parseLocalInput,
  type Recurrence,
  timeZoneNames,
  zonedParts,
} from "@shared/recurrence";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { Textarea } from "@/ui/textarea";
import { api, errorText } from "../lib/api";
import {
  channelsQuery,
  maintenanceQuery,
  monitorsQuery,
  statusPagesQuery,
} from "../lib/queries";
import { refreshQueries } from "../lib/query-sync";
import { useRole } from "../lib/use-role";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContentSkeleton } from "../ui/skeleton";
import { CheckList, NotifyFields } from "./announcement-fields";
import { controlClass, Field, GroupField } from "./fields";
import { ErrorAlert } from "./status-notice";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

function weekdayLabel(day: number): string {
  if (day === 0) return t("weekday_sun");
  if (day === 1) return t("weekday_mon");
  if (day === 2) return t("weekday_tue");
  if (day === 3) return t("weekday_wed");
  if (day === 4) return t("weekday_thu");
  if (day === 5) return t("weekday_fri");
  return t("weekday_sat");
}

function recurrenceLabel(value: Recurrence): string {
  if (value === "daily") return t("maintenance_daily");
  if (value === "weekly") return t("maintenance_weekly");
  if (value === "monthly") return t("maintenance_monthly");
  return t("maintenance_once");
}

export function MaintenanceCreatePage() {
  return <MaintenanceEditor />;
}

export function MaintenanceEditPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const existing = useQuery(maintenanceQuery(id));
  if (!existing.data) {
    return existing.isError ? (
      <ErrorAlert>{t("error_not_found")}</ErrorAlert>
    ) : (
      <ContentSkeleton />
    );
  }
  return (
    <MaintenanceEditor
      key={existing.data.updatedAt}
      id={id}
      initial={existing.data}
    />
  );
}

function MaintenanceEditor({
  id,
  initial,
}: {
  id?: string;
  initial?: {
    title: string;
    description: string;
    timezone: string;
    startAt: number;
    endAt: number;
    recurrence: string;
    weekdays: number[];
    notify: boolean;
    cancelledAt: number | null;
    monitorIds: string[];
    pageIds: string[];
    channelIds: string[];
  };
}) {
  const role = useRole();
  const writable = role ? can({ role }, "maintenance.write") : false;
  const navigate = useNavigate();
  const client = useQueryClient();
  const monitors = useQuery(monitorsQuery);
  const pages = useQuery(statusPagesQuery);
  const channels = useQuery(channelsQuery);
  const save = useSubmitGuard();
  const danger = useSubmitGuard();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [error, setError] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? browserZone);
  const [zoneQuery, setZoneQuery] = useState("");
  const [start, setStart] = useState(
    formatLocalInput(
      initial?.startAt ?? Date.now() + 3_600_000,
      initial?.timezone ?? browserZone,
    ),
  );
  const [end, setEnd] = useState(
    formatLocalInput(
      initial?.endAt ?? Date.now() + 2 * 3_600_000,
      initial?.timezone ?? browserZone,
    ),
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(
    initial?.recurrence === "daily" ||
      initial?.recurrence === "weekly" ||
      initial?.recurrence === "monthly"
      ? initial.recurrence
      : "once",
  );
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [monitorIds, setMonitorIds] = useState(initial?.monitorIds ?? []);
  const [pageIds, setPageIds] = useState(initial?.pageIds ?? []);
  const [notify, setNotify] = useState(initial?.notify ?? false);
  const [channelIds, setChannelIds] = useState(initial?.channelIds ?? []);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const zones = useMemo(() => {
    const names = timeZoneNames();
    const query = zoneQuery.trim().toLowerCase();
    const matched = query
      ? names.filter((name) => name.toLowerCase().includes(query))
      : names.filter((name) => ["UTC", browserZone, timezone].includes(name));
    const unique = [...new Set([timezone, ...matched])];
    return unique.slice(0, 40);
  }, [zoneQuery, timezone, browserZone]);

  const preview = useMemo(() => {
    const startAt = parseLocalInput(start, timezone);
    const endAt = parseLocalInput(end, timezone);
    if (startAt == null || endAt == null || endAt <= startAt) return [];
    let days = weekdays;
    if (recurrence === "weekly") {
      const weekday = zonedParts(startAt, timezone).weekday;
      if (!days.includes(weekday)) days = [...days, weekday];
    }
    const schedule: MaintenanceSchedule = {
      startAt,
      endAt,
      timezone,
      recurrence,
      weekdays: days,
      cancelledAt: initial?.cancelledAt ?? null,
    };
    return nextOccurrences(schedule, Date.now(), 5);
  }, [start, end, timezone, recurrence, weekdays, initial?.cancelledAt]);

  async function refresh() {
    await refreshQueries(client, [
      ["maintenance"],
      ["maintenance-window", id ?? ""],
    ]);
  }

  return (
    <div className="min-w-0">
      <AppHeader
        title={id ? t("maintenance_edit") : t("maintenance_new")}
        actions={
          <Button asChild variant="outline">
            <Link to="/console/maintenance">{t("maintenance_back")}</Link>
          </Button>
        }
      />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const startAt = parseLocalInput(start, timezone);
          const endAt = parseLocalInput(end, timezone);
          if (startAt == null || endAt == null || monitorIds.length === 0) {
            setError(t("error_validation"));
            return;
          }
          let days = [...new Set(weekdays)];
          if (recurrence === "weekly") {
            const weekday = zonedParts(startAt, timezone).weekday;
            if (!days.includes(weekday)) days = [...days, weekday];
          }
          const body = {
            title: title.trim(),
            description: description.trim(),
            timezone,
            startAt,
            endAt,
            recurrence,
            weekdays: days,
            notify,
            channelIds,
            pageIds,
            monitorIds,
          };
          void save.run(async () => {
            try {
              if (!id) {
                const created = await api<{ id: string }>("/api/maintenance", {
                  method: "POST",
                  body: JSON.stringify(body),
                });
                await refresh();
                await navigate({
                  to: "/console/maintenance/$id",
                  params: { id: created.id },
                });
                return;
              }
              await api(`/api/maintenance/${id}`, {
                method: "PATCH",
                body: JSON.stringify(body),
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
            <CardTitle>{t("maintenance_details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field
              label={t("maintenance_name")}
              hint={t("maintenance_name_hint")}
            >
              <Input
                value={title}
                required
                disabled={!writable || Boolean(initial?.cancelledAt)}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field
              label={t("maintenance_description")}
              hint={t("maintenance_description_hint")}
            >
              <Textarea
                value={description}
                disabled={!writable || Boolean(initial?.cancelledAt)}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <GroupField
              label={t("maintenance_monitors")}
              hint={t("maintenance_monitors_hint")}
            >
              <CheckList
                options={(monitors.data?.monitors ?? []).map((monitor) => ({
                  id: monitor.id,
                  label: monitor.name,
                }))}
                selected={monitorIds}
                onChange={setMonitorIds}
                empty={t("incident_monitors_empty")}
              />
            </GroupField>
            <GroupField
              label={t("maintenance_pages")}
              hint={t("maintenance_pages_hint")}
            >
              <CheckList
                options={(pages.data?.pages ?? []).map((page) => ({
                  id: page.id,
                  label: page.title,
                }))}
                selected={pageIds}
                onChange={setPageIds}
                empty={t("incident_pages_empty")}
              />
            </GroupField>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("maintenance_schedule")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field
              label={t("maintenance_timezone")}
              hint={t("maintenance_timezone_hint")}
            >
              <Input
                value={zoneQuery}
                placeholder={t("maintenance_timezone_search")}
                onChange={(event) => setZoneQuery(event.target.value)}
              />
              <select
                className={`${controlClass} mt-2`}
                value={timezone}
                disabled={!writable || Boolean(initial?.cancelledAt)}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {zones.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("maintenance_start")}
                hint={t("maintenance_start_hint")}
              >
                <Input
                  type="datetime-local"
                  value={start}
                  disabled={!writable || Boolean(initial?.cancelledAt)}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field
                label={t("maintenance_end")}
                hint={t("maintenance_end_hint")}
              >
                <Input
                  type="datetime-local"
                  value={end}
                  disabled={!writable || Boolean(initial?.cancelledAt)}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </Field>
            </div>
            <GroupField
              label={t("maintenance_recurrence")}
              hint={t("maintenance_recurrence_hint")}
            >
              <div className="flex flex-wrap gap-2">
                {(["once", "daily", "weekly", "monthly"] as const).map(
                  (value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={recurrence === value ? "default" : "outline"}
                      aria-pressed={recurrence === value}
                      disabled={!writable || Boolean(initial?.cancelledAt)}
                      onClick={() => setRecurrence(value)}
                    >
                      {recurrenceLabel(value)}
                    </Button>
                  ),
                )}
              </div>
            </GroupField>
            {recurrence === "weekly" ? (
              <GroupField
                label={t("maintenance_weekdays")}
                hint={t("maintenance_weekdays_hint")}
              >
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const checked = weekdays.includes(day);
                    return (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={checked ? "default" : "outline"}
                        aria-pressed={checked}
                        disabled={!writable || Boolean(initial?.cancelledAt)}
                        onClick={() =>
                          setWeekdays(
                            checked
                              ? weekdays.filter((item) => item !== day)
                              : [...weekdays, day],
                          )
                        }
                      >
                        {weekdayLabel(day)}
                      </Button>
                    );
                  })}
                </div>
              </GroupField>
            ) : null}
            <div>
              <p className="text-sm font-medium">{t("maintenance_preview")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("maintenance_preview_hint")}
              </p>
              {preview.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("maintenance_preview_empty")}
                </p>
              ) : (
                <ol className="mt-2 grid gap-1 text-sm">
                  {preview.map((item) => (
                    <li key={item.start} className="break-words">
                      {new Intl.DateTimeFormat(textLang, {
                        timeZone: timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(item.start)}
                      {" – "}
                      {new Intl.DateTimeFormat(textLang, {
                        timeZone: timezone,
                        timeStyle: "short",
                      }).format(item.end)}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
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
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        {writable && !initial?.cancelledAt ? (
          <PendingButton type="submit" pending={save.pending}>
            {id ? t("action_save") : t("action_create")}
          </PendingButton>
        ) : null}
      </form>
      {id && writable ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!initial?.cancelledAt ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmCancel(true)}
            >
              {t("maintenance_cancel")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("maintenance_cancelled_note")}
            </p>
          )}
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            {t("maintenance_delete")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("maintenance_cancel_title")}
        description={t("maintenance_cancel_body")}
        confirmLabel={t("maintenance_cancel")}
        cancelLabel={t("action_back")}
        pending={danger.pending}
        onConfirm={() => {
          if (!id) return;
          void danger.run(async () => {
            try {
              await api(`/api/maintenance/${id}/cancel`, { method: "POST" });
              setConfirmCancel(false);
              await refresh();
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("maintenance_delete_title")}
        description={t("maintenance_delete_body")}
        confirmLabel={t("action_delete")}
        cancelLabel={t("action_cancel")}
        pending={danger.pending}
        onConfirm={() => {
          if (!id) return;
          void danger.run(async () => {
            try {
              await api(`/api/maintenance/${id}`, { method: "DELETE" });
              await refresh();
              setConfirmDelete(false);
              await navigate({ to: "/console/maintenance" });
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      />
    </div>
  );
}
