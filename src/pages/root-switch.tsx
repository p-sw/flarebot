// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { Loader2 } from "lucide-react";
import { ApiClientError } from "../lib/api";
import { Switch } from "../ui/switch";

export function rootToggleError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 400) return t("page_root_unpublished");
    if (error.status === 403) return t("error_forbidden");
    if (error.status === 409) return t("page_root_conflict");
  }
  return t("page_root_failed");
}

export function RootSwitch({
  checked,
  pending,
  disabled,
  describedBy,
  onCheckedChange,
}: {
  checked: boolean;
  pending: boolean;
  disabled?: boolean;
  describedBy?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const locked = pending || disabled;
  return (
    // The switch is the labeled control.
    // biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control
    <label className="flex min-w-0 items-center gap-3 text-sm">
      <Switch
        checked={checked}
        disabled={locked}
        aria-busy={pending || undefined}
        aria-describedby={describedBy}
        onCheckedChange={(next) => {
          if (locked) return;
          onCheckedChange(next);
        }}
      />
      <span className="min-w-0">{t("page_root_label")}</span>
      {pending ? (
        <span
          role="status"
          className="inline-flex shrink-0 items-center text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="sr-only">{t("page_root_busy")}</span>
        </span>
      ) : null}
    </label>
  );
}
