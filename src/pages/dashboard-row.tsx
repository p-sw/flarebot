// SPDX-License-Identifier: MIT

import { formatTime, t } from "@shared/copy";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Loader2, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { cn } from "../lib/cn";
import { type MonitorListItem, sparkQuery } from "../lib/queries";
import { useMotionPrefs } from "../motion/page";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { responseText, statusTone } from "./fields";
import { monitorStatusLabel, monitorTypeLabel } from "./monitor-labels";
import { regionLabel } from "./region-select";

function PauseControl({
  paused,
  pending,
  disabled,
  onClick,
}: {
  paused: boolean;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : paused ? (
        <Play className="h-4 w-4" aria-hidden />
      ) : (
        <Pause className="h-4 w-4" aria-hidden />
      )}
      {paused ? t("action_resume") : t("action_pause")}
    </Button>
  );
}

function SparkPanel({ id, type }: { id: string; type: string }) {
  const spark = useQuery(sparkQuery(id));
  const data = spark.data;
  const points = data?.points ?? [];
  return (
    <div className="grid min-w-0 gap-3 border-t border-border bg-muted/40 px-4 py-3">
      {spark.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <>
          <dl className="grid min-w-0 grid-cols-3 gap-2">
            <div className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">
                {t("dashboard_current")}
              </dt>
              <dd className="truncate text-sm font-medium tabular-nums">
                {responseText(data?.currentMs ?? null)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">
                {t("dashboard_average")}
              </dt>
              <dd className="truncate text-sm font-medium tabular-nums">
                {responseText(data?.averageMs ?? null)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">
                {t("dashboard_uptime")}
              </dt>
              <dd className="truncate text-sm font-medium tabular-nums">
                {data?.uptime == null
                  ? t("uptime_empty")
                  : t("uptime_percent", { value: data.uptime })}
              </dd>
            </div>
          </dl>
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("chart_empty")}</p>
          ) : (
            <ChartContainer
              config={{
                ms: {
                  label:
                    type === "http"
                      ? t("chart_response_ttfb")
                      : t("chart_response"),
                  color: "var(--primary)",
                },
              }}
              className="h-28"
            >
              <AreaChart
                data={points.map((point) => ({
                  ...point,
                  label: formatTime(point.t),
                }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis dataKey="label" hide />
                <YAxis hide width={0} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="ms"
                  name={t("chart_series_ms")}
                  type="monotone"
                  stroke="var(--color-ms)"
                  fill="var(--color-ms)"
                  fillOpacity={0.2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          )}
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {t("dashboard_spark_hint", { count: points.length })}
            </p>
            <Link
              to="/console/monitors/$id"
              params={{ id }}
              className="shrink-0 text-sm font-medium underline-offset-2 hover:underline"
            >
              {t("dashboard_open")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export function DashboardRow({
  row,
  pausePending,
  pauseDisabled,
  onPause,
}: {
  row: MonitorListItem;
  pausePending: boolean;
  pauseDisabled: boolean;
  onPause: () => void;
}) {
  const [open, setOpen] = useState(false);
  const motionPrefs = useMotionPrefs();
  const meta = row.target
    ? `${monitorTypeLabel(row.type)} · ${row.target}`
    : monitorTypeLabel(row.type);
  const uptime =
    row.uptime24 === null
      ? t("uptime_empty")
      : t("uptime_percent", { value: row.uptime24 });
  const showRegion = row.region !== "inherit" || row.effectiveRegion !== "auto";
  const regionText = regionLabel(row.effectiveRegion);
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="monitor-row">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:flex lg:gap-x-4">
        <Link
          to="/console/monitors/$id"
          params={{ id: row.id }}
          className="order-1 min-w-0 lg:order-none lg:flex-1"
          title={row.name}
        >
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground" title={meta}>
            {meta}
          </p>
        </Link>
        <div className="order-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 lg:order-none lg:flex-nowrap">
          {showRegion ? (
            <Badge
              className="max-w-full"
              title={
                row.region === "inherit"
                  ? t("monitor_region_inherited")
                  : t("monitor_region_override")
              }
            >
              <span className="max-w-40 truncate">{regionText}</span>
            </Badge>
          ) : null}
          <span
            className="min-w-0 truncate text-sm tabular-nums lg:w-14 lg:text-end"
            title={uptime}
          >
            {uptime}
          </span>
          <span
            className="min-w-0 truncate font-mono text-xs tabular-nums text-muted-foreground lg:w-16 lg:text-end"
            title={responseText(row.lastResponseMs)}
          >
            {responseText(row.lastResponseMs)}
          </span>
          <span className="flex lg:min-w-24">
            <Badge tone={statusTone(row.status)}>
              {monitorStatusLabel(row.status)}
            </Badge>
          </span>
        </div>
        <span className="order-4 flex justify-end lg:order-none lg:min-w-26">
          <PauseControl
            paused={row.paused}
            pending={pausePending}
            disabled={pauseDisabled}
            onClick={onPause}
          />
        </span>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="order-2 h-8 w-8 justify-self-end text-muted-foreground lg:order-none"
            aria-label={
              open
                ? t("dashboard_collapse", { name: row.name })
                : t("dashboard_expand", { name: row.name })
            }
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent forceMount className="min-w-0 overflow-hidden">
        <motion.div
          initial={false}
          animate={{
            height: open ? "auto" : 0,
            opacity: open ? 1 : 0,
          }}
          transition={motionPrefs.still ? { duration: 0 } : motionPrefs.snappy}
          className="overflow-hidden"
        >
          {open ? <SparkPanel id={row.id} type={row.type} /> : null}
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
}
