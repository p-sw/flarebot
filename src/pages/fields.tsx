// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // The input is passed as children, which the linter cannot see.
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the child field
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
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
