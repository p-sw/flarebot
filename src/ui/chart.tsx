// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";
import * as Recharts from "recharts";
import { cn } from "../lib/cn";

export type ChartConfig = Record<
  string,
  {
    label?: ReactNode;
    color?: string;
  }
>;

export function ChartContainer({
  className,
  config,
  children,
}: {
  className?: string;
  config: ChartConfig;
  children: React.ComponentProps<
    typeof Recharts.ResponsiveContainer
  >["children"];
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [
      `--color-${key}`,
      item.color ?? "var(--primary)",
    ]),
  );
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex w-full min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
        className,
      )}
      style={style}
    >
      <Recharts.ResponsiveContainer width="100%" height="100%">
        {children}
      </Recharts.ResponsiveContainer>
    </div>
  );
}

export const ChartTooltip = Recharts.Tooltip;

export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: unknown;
    value?: unknown;
    color?: string;
    dataKey?: unknown;
  }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-0 gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-card-foreground shadow-sm">
      {label ? (
        <p className="tabular-nums text-muted-foreground">{label}</p>
      ) : null}
      {payload.map((item) => (
        <p key={String(item.dataKey ?? item.name)} className="tabular-nums">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm"
            style={{ background: item.color ?? "var(--primary)" }}
          />
          {String(item.name ?? item.dataKey ?? "")} {String(item.value ?? "")}
        </p>
      ))}
    </div>
  );
}
