// SPDX-License-Identifier: MIT

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const alertVariants = cva(
  "relative grid w-full min-w-0 max-w-full grid-cols-[0_minmax(0,1fr)] items-start gap-y-1.5 rounded-lg border px-4 py-3 text-sm text-alert-foreground has-[>svg]:grid-cols-[1rem_minmax(0,1fr)] has-[>svg]:gap-x-3 [&_a]:text-inherit [&_code]:text-inherit [&_em]:text-inherit [&_strong]:text-inherit [&>svg]:col-start-1 [&>svg]:row-start-1 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-1",
  {
    variants: {
      variant: {
        default: "border-border bg-alert-default [&>svg]:text-muted-foreground",
        destructive:
          "border-status-down/25 bg-alert-destructive [&>svg]:text-status-down-foreground",
        warning:
          "border-status-pending/40 bg-alert-warning [&>svg]:text-status-pending-foreground",
        maintenance:
          "border-primary/20 bg-alert-maintenance [&>svg]:text-primary",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-w-0 break-words font-medium leading-6",
        className,
      )}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 min-w-0 break-words text-sm leading-6 [&_p]:leading-6",
        className,
      )}
      {...props}
    />
  );
}

/** Status chips inside an alert are outlined so the tint stays the only fill. */
export const alertBadgeClass =
  "border border-foreground/20 bg-transparent text-current";
