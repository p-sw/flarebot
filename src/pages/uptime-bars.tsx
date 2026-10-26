// SPDX-License-Identifier: MIT

import { formatDateTime, formatTime, t } from "@shared/copy";
import { DAY_MS, fitBars, type HistoryBar } from "@shared/history";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { responseText } from "./fields";

function useNarrow() {
  const query = "(max-width: 480px)";
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function spanText(bar: HistoryBar): string {
  const short = bar.end - bar.start <= DAY_MS;
  const from = short ? formatTime(bar.start) : formatDateTime(bar.start);
  const to = short ? formatTime(bar.end) : formatDateTime(bar.end);
  return t("status_bar_span", { from, to });
}

function detailText(bar: HistoryBar): string {
  if (bar.state === "maintenance") return t("status_bar_maintenance");
  if (bar.uptime === null) return t("chart_empty");
  return t("status_bar_title", {
    uptime: t("uptime_percent", { value: bar.uptime }),
    response: responseText(bar.responseMs),
  });
}

function barLabel(bar: HistoryBar): string {
  const incidents =
    bar.incidents === 0
      ? t("status_bar_clear")
      : t("status_bar_incidents", { count: bar.incidents });
  return `${spanText(bar)}. ${detailText(bar)}. ${incidents}`;
}

function barClass(bar: HistoryBar): string {
  if (bar.state === "maintenance") return "bg-primary";
  if (bar.state === "up") return "bg-status-up";
  if (bar.state === "degraded") return "bg-status-pending";
  if (bar.state === "down") return "bg-status-down";
  if (bar.state === "empty" || bar.uptime === null) return "bg-muted";
  if (bar.uptime >= 99) return "bg-status-up";
  if (bar.uptime >= 90) return "bg-status-pending";
  return "bg-status-down";
}

export function UptimeBars({ bars }: { bars: HistoryBar[] }) {
  const narrow = useNarrow();
  const shown = fitBars(bars, narrow ? 48 : bars.length);
  const [active, setActive] = useState<number | null>(null);
  const current = active === null ? null : (shown[active] ?? null);
  return (
    <div className="mt-3 min-w-0">
      <ul
        className="m-0 flex h-8 min-w-0 list-none items-stretch gap-px p-0"
        aria-label={t("chart_recent")}
      >
        {shown.map((bar, index) => (
          <li key={`${bar.start}-${bar.end}`} className="flex min-w-0 flex-1">
            <button
              type="button"
              className={cn(
                "h-8 w-full min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                barClass(bar),
                bar.maint > 0 &&
                  bar.state !== "maintenance" &&
                  "border-t-2 border-primary",
              )}
              aria-pressed={active === index}
              aria-label={barLabel(bar)}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() =>
                setActive((currentIndex) =>
                  currentIndex === index ? null : currentIndex,
                )
              }
              onFocus={() => setActive(index)}
              onBlur={() =>
                setActive((currentIndex) =>
                  currentIndex === index ? null : currentIndex,
                )
              }
              onClick={() =>
                setActive((currentIndex) =>
                  currentIndex === index ? null : index,
                )
              }
            />
          </li>
        ))}
      </ul>
      {current ? (
        <div
          role="tooltip"
          className="mt-2 max-w-full min-w-0 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-card-foreground"
        >
          <p className="truncate tabular-nums" title={spanText(current)}>
            {spanText(current)}
          </p>
          <p className="truncate tabular-nums">{detailText(current)}</p>
          <p className="truncate">
            {current.incidents === 0
              ? t("status_bar_clear")
              : t("status_bar_incidents", { count: current.incidents })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
