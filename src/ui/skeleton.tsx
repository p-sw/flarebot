// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { cn } from "../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-muted motion-safe:animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function ContentSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
