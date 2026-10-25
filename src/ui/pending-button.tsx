// SPDX-License-Identifier: MIT

import type { ButtonHTMLAttributes } from "react";
import { pendingButtonProps } from "../lib/submit-guard";
import { m } from "../paraglide/messages.js";
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
      {pending ? m.action_working() : children}
    </Button>
  );
}
