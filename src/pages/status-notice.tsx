// SPDX-License-Identifier: MIT

import {
  CalendarClock,
  CircleAlert,
  Info,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  alertBadgeClass,
} from "@/ui/alert";
import type { AlertVariant } from "@/ui/alert-variant";
import { Badge } from "@/ui/badge";

const icons: Record<AlertVariant, LucideIcon> = {
  default: Info,
  destructive: CircleAlert,
  warning: TriangleAlert,
  maintenance: CalendarClock,
};

export function StatusNotice({
  variant,
  title,
  badge,
  children,
  className,
}: {
  variant: AlertVariant;
  title: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = icons[variant];
  return (
    <Alert variant={variant} className={className}>
      <Icon aria-hidden="true" />
      <AlertTitle className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 break-words">{title}</div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </AlertTitle>
      {children ? <AlertDescription>{children}</AlertDescription> : null}
    </Alert>
  );
}

export function StatusNoticeBadge({ children }: { children: ReactNode }) {
  return <Badge className={alertBadgeClass}>{children}</Badge>;
}

export function BannerAlert({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert variant="default" className={className}>
      <Info aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function ErrorAlert({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
