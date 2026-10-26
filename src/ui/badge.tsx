// SPDX-License-Identifier: MIT

import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const tones = {
  up: "bg-status-up/15 text-status-up-foreground",
  down: "bg-status-down/15 text-status-down-foreground",
  pending: "bg-status-pending/20 text-status-pending-foreground",
  unknown: "bg-muted text-muted-foreground",
  paused: "bg-muted text-muted-foreground",
  neutral: "bg-muted text-muted-foreground",
  maintenance: "bg-primary/15 text-primary",
  degraded: "bg-status-pending/20 text-status-pending-foreground",
  partial: "bg-status-pending/20 text-status-pending-foreground",
  major: "bg-status-down/15 text-status-down-foreground",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
