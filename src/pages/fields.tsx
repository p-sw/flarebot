// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { ReactNode } from "react";

export const controlClass =
  "h-10 w-full min-w-0 max-w-full rounded-lg border border-input bg-card px-3";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    // The input is passed as children, which the linter cannot see.
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the child field
    <label className="grid min-w-0 gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-destructive">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/** A labelled group of controls. A label would steal each control's name. */
export function GroupField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-1.5 border-0 p-0 text-sm">
      <legend className="font-medium">{label}</legend>
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </fieldset>
  );
}

// A heartbeat has no round trip, and a connect that finishes in the same
// millisecond is stored as 0. Both read as an empty measurement.
export function responseText(ms: number | null): string {
  if (ms == null || ms <= 0) return t("uptime_empty");
  return t("response_ms", { value: ms });
}

export function statusTone(
  status: string,
):
  | "up"
  | "down"
  | "pending"
  | "paused"
  | "unknown"
  | "maintenance"
  | "degraded"
  | "partial"
  | "major" {
  if (status === "maintenance") return "maintenance";
  if (status === "degraded") return "degraded";
  if (status === "partial_outage") return "partial";
  if (status === "major_outage") return "major";
  if (
    status === "up" ||
    status === "down" ||
    status === "pending" ||
    status === "paused"
  )
    return status;
  return "unknown";
}
