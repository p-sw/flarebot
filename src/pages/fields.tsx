// SPDX-License-Identifier: MIT

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

export function statusTone(
  status: string,
): "up" | "down" | "pending" | "paused" | "unknown" {
  if (
    status === "up" ||
    status === "down" ||
    status === "pending" ||
    status === "paused"
  )
    return status;
  return "unknown";
}
