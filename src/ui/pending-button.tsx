// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { ButtonHTMLAttributes } from "react";
import { pendingButtonProps } from "../lib/submit-guard";
import { Button } from "./button";

export function PendingButton({
  pending = false,
  children,
  disabled,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon";
}) {
  const state = pendingButtonProps(pending);
  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      disabled={disabled || state.disabled}
      aria-busy={state["aria-busy"]}
    >
      {pending ? t("action_working") : children}
    </Button>
  );
}
