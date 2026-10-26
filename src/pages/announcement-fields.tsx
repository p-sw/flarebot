// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { Impact } from "@shared/impact";
import { Switch } from "@/ui/switch";
import { controlClass } from "./fields";

export function impactLabel(impact: string): string {
  if (impact === "partial_outage") return t("incident_impact_partial");
  if (impact === "major_outage") return t("incident_impact_major");
  return t("incident_impact_degraded");
}

export function incidentStatusLabel(status: string): string {
  if (status === "identified") return t("incident_status_identified");
  if (status === "monitoring") return t("incident_status_monitoring");
  if (status === "resolved") return t("incident_status_resolved");
  if (status === "investigating") return t("incident_status_investigating");
  if (status === "degraded") return t("status_degraded");
  if (status === "partial_outage") return t("status_partial_outage");
  if (status === "major_outage") return t("status_major_outage");
  if (status === "maintenance") return t("status_maintenance");
  return t("status_unknown");
}

export function CheckList({
  options,
  selected,
  onChange,
  empty,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  empty: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              checked={checked}
              onChange={() => {
                onChange(
                  checked
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id],
                );
              }}
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function MonitorImpacts({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: { monitorId: string; impact: Impact }[];
  onChange: (next: { monitorId: string; impact: Impact }[]) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("incident_monitors_empty")}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const current = value.find((item) => item.monitorId === option.id);
        return (
          <div
            key={option.id}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                checked={Boolean(current)}
                onChange={() => {
                  onChange(
                    current
                      ? value.filter((item) => item.monitorId !== option.id)
                      : [
                          ...value,
                          { monitorId: option.id, impact: "major_outage" },
                        ],
                  );
                }}
              />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
            {current ? (
              <select
                aria-label={t("incident_impact")}
                className={`${controlClass} w-full sm:w-48`}
                value={current.impact}
                onChange={(event) => {
                  const impact = event.target.value as Impact;
                  onChange(
                    value.map((item) =>
                      item.monitorId === option.id ? { ...item, impact } : item,
                    ),
                  );
                }}
              >
                <option value="degraded">
                  {t("incident_impact_degraded")}
                </option>
                <option value="partial_outage">
                  {t("incident_impact_partial")}
                </option>
                <option value="major_outage">
                  {t("incident_impact_major")}
                </option>
              </select>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function NotifyFields({
  notify,
  onNotify,
  channels,
  channelIds,
  onChannels,
}: {
  notify: boolean;
  onNotify: (value: boolean) => void;
  channels: { id: string; label: string }[];
  channelIds: string[];
  onChannels: (ids: string[]) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="grid gap-1">
          <span className="text-sm font-medium">{t("incident_notify")}</span>
          <span className="text-xs text-muted-foreground">
            {t("incident_notify_hint")}
          </span>
        </span>
        <Switch
          checked={notify}
          onCheckedChange={onNotify}
          aria-label={t("incident_notify")}
        />
      </div>
      {notify ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            {t("incident_channels_hint")}
          </p>
          <CheckList
            options={channels}
            selected={channelIds}
            onChange={onChannels}
            empty={t("incident_channels_empty")}
          />
        </div>
      ) : null}
    </div>
  );
}
