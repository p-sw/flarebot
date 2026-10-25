// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { Input } from "../../ui/input";
import {
  MonitorTypeIcon,
  monitorSearchText,
  monitorTypeLabel,
  StatusDot,
} from "./chrome";
import { filterMonitors, type LayoutMonitor } from "./model";

export function MonitorPicker({
  monitors,
  disabled,
  describedBy,
  onOpenChange,
  onAdd,
}: {
  monitors: readonly LayoutMonitor[];
  disabled?: boolean;
  describedBy?: string;
  onOpenChange?: (open: boolean) => void;
  onAdd: (monitor: LayoutMonitor) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = filterMonitors(monitors, query, monitorSearchText);
  const activeIndex =
    filtered.length === 0 ? 0 : Math.min(active, filtered.length - 1);
  const activeMonitor = filtered[activeIndex];

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !activeMonitor) return;
    document
      .getElementById(`${listId}-opt-${activeMonitor.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeMonitor, listId]);

  function choose(monitor: LayoutMonitor) {
    onAdd(monitor);
    setQuery("");
    setActive(0);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeMonitor
            ? `${listId}-opt-${activeMonitor.id}`
            : undefined
        }
        aria-label={t("page_monitor_pick")}
        aria-describedby={describedBy}
        placeholder={t("page_monitor_search")}
        autoComplete="off"
        value={query}
        disabled={disabled}
        className="text-base sm:text-sm"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActive(0);
              return;
            }
            setActive((current) =>
              Math.min(current + 1, Math.max(filtered.length - 1, 0)),
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) => Math.max(current - 1, 0));
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            setActive(0);
            return;
          }
          if (event.key === "End") {
            event.preventDefault();
            setActive(Math.max(filtered.length - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && activeMonitor) choose(activeMonitor);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("page_monitor_pick")}
          className="absolute inset-x-0 z-30 mt-1 max-h-[min(16rem,40vh)] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("page_monitor_no_match")}
            </p>
          ) : (
            filtered.map((monitor, index) => {
              const type = monitor.type ?? "";
              const typeLabel = type ? monitorTypeLabel(type) : "";
              const target = monitor.target ?? "";
              return (
                <div
                  key={monitor.id}
                  id={`${listId}-opt-${monitor.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left",
                    index === activeIndex && "bg-muted",
                  )}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(monitor)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    choose(monitor);
                  }}
                >
                  <StatusDot status={monitor.status ?? "unknown"} />
                  <MonitorTypeIcon type={type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {monitor.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {typeLabel}
                      {target ? (
                        <span>
                          {" · "}
                          {target}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
