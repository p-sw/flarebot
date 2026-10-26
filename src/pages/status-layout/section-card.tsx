// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { LayoutItem, LayoutSection } from "@shared/status-layout";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useId,
} from "react";
import { cn } from "../../lib/cn";
import { useMotionPrefs } from "../../motion/page";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import type { LayoutMonitor } from "./model";
import { MonitorPicker } from "./monitor-picker";
import { MonitorRow } from "./monitor-row";

function LayoutArticle({
  className,
  label,
  sectionIndex,
  children,
}: {
  className?: string;
  label: string;
  sectionIndex: number;
  children: ReactNode;
}) {
  const motionPrefs = useMotionPrefs();
  if (motionPrefs.still) {
    return (
      <article
        className={className}
        aria-label={label}
        data-section-index={sectionIndex}
      >
        {children}
      </article>
    );
  }
  return (
    <motion.article
      layout="position"
      className={className}
      aria-label={label}
      data-section-index={sectionIndex}
      transition={motionPrefs.snappy}
    >
      {children}
    </motion.article>
  );
}

function LayoutSlot({
  className,
  itemIndex,
  children,
}: {
  className?: string;
  itemIndex: number;
  children: ReactNode;
}) {
  const motionPrefs = useMotionPrefs();
  if (motionPrefs.still) {
    return (
      <li className={className} data-item-index={itemIndex}>
        {children}
      </li>
    );
  }
  return (
    <motion.li
      layout="position"
      className={className}
      data-item-index={itemIndex}
      transition={motionPrefs.snappy}
    >
      {children}
    </motion.li>
  );
}

function moveWithArrows(
  event: KeyboardEvent<HTMLButtonElement>,
  onUp: () => void,
  onDown: () => void,
) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  if (event.key === "ArrowUp") onUp();
  else onDown();
}

export function SectionCard({
  section,
  sectionIndex,
  sectionCount,
  monitors,
  available,
  disabled,
  dragging,
  marked,
  append,
  itemDragKey,
  itemMarkIndex,
  pickerOpen,
  reorderDescribedBy,
  displayDescribedBy,
  monitorDescribedBy,
  onPickerOpenChange,
  onRename,
  onAskRemove,
  onMoveUp,
  onMoveDown,
  onAddMonitor,
  onDisplayName,
  onMoveItem,
  onMoveItemToSection,
  onRemoveItem,
  onPointerDown,
}: {
  section: LayoutSection;
  sectionIndex: number;
  sectionCount: number;
  monitors: readonly LayoutMonitor[];
  available: readonly LayoutMonitor[];
  disabled?: boolean;
  dragging: boolean;
  marked: boolean;
  append: boolean;
  itemDragKey: string | null;
  itemMarkIndex: number | null;
  pickerOpen: boolean;
  reorderDescribedBy: string;
  displayDescribedBy: string;
  monitorDescribedBy: string;
  onPickerOpenChange: (open: boolean) => void;
  onRename: (name: string) => void;
  onAskRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddMonitor: (monitor: LayoutMonitor) => void;
  onDisplayName: (item: LayoutItem, value: string) => void;
  onMoveItem: (itemIndex: number, toIndex: number) => void;
  onMoveItemToSection: (itemIndex: number, direction: -1 | 1) => void;
  onRemoveItem: (item: LayoutItem) => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: "section" | "item",
    itemIndex: number | null,
    label: string,
  ) => void;
}) {
  const hintId = useId();
  const title = section.name.trim() || t("page_section");
  const totalMonitors = monitors.length;
  return (
    <LayoutArticle
      label={title}
      sectionIndex={sectionIndex}
      className={cn(
        "grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3",
        (dragging || pickerOpen) && "relative z-20",
        dragging && "shadow-lg ring-1 ring-ring",
        marked && "shadow-[inset_0_2px_0_0_var(--ring)]",
        append && "shadow-[inset_0_-2px_0_0_var(--ring)]",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 shrink-0 touch-none text-muted-foreground"
            aria-label={t("page_drag", { name: title })}
            aria-keyshortcuts="ArrowUp ArrowDown"
            aria-describedby={reorderDescribedBy}
            disabled={disabled}
            onPointerDown={(event) =>
              onPointerDown(event, "section", null, title)
            }
            onKeyDown={(event) => moveWithArrows(event, onMoveUp, onMoveDown)}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <label className="grid min-w-0 gap-1" htmlFor={hintId}>
              <span className="sr-only">{t("page_section_name")}</span>
              <Input
                id={hintId}
                value={section.name}
                maxLength={80}
                disabled={disabled}
                placeholder={t("page_section_placeholder")}
                aria-describedby={`${hintId}-hint`}
                title={section.name}
                className="h-11 border-transparent bg-transparent px-2 text-base font-medium shadow-none hover:border-border focus-visible:border-input focus-visible:bg-background sm:text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                onChange={(event) => onRename(event.target.value)}
              />
            </label>
          </div>
          <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-muted px-2 text-xs tabular-nums whitespace-nowrap text-muted-foreground">
            {t("monitors_count", { count: section.items.length })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11 shrink-0 text-muted-foreground"
                aria-label={t("page_actions", { name: title })}
                disabled={disabled}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem
                className="min-h-11"
                disabled={sectionIndex === 0}
                onSelect={onMoveUp}
              >
                {t("page_move_up", { name: title })}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11"
                disabled={sectionIndex >= sectionCount - 1}
                onSelect={onMoveDown}
              >
                {t("page_move_down", { name: title })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11 text-destructive"
                onSelect={onAskRemove}
              >
                {t("page_section_delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p
          id={`${hintId}-hint`}
          className="truncate ps-12 text-xs text-muted-foreground"
          title={t("page_section_hint")}
        >
          {t("page_section_hint")}
        </p>
      </div>
      {section.items.length === 0 ? (
        <p className="flex min-h-16 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground">
          {t("page_section_empty")}
        </p>
      ) : (
        <ul
          className="grid min-w-0 gap-2"
          aria-label={t("page_section_monitors", { name: title })}
        >
          {section.items.map((item, itemIndex) => {
            const source = monitors.find(
              (monitor) => monitor.id === item.monitorId,
            );
            const label =
              item.displayName.trim() ||
              item.monitorName.trim() ||
              source?.name ||
              t("monitor_fallback_name");
            return (
              <LayoutSlot
                key={item.key}
                itemIndex={itemIndex}
                className="min-w-0 list-none"
              >
                <MonitorRow
                  item={item}
                  originalName={
                    item.monitorName.trim() || source?.name.trim() || ""
                  }
                  type={source?.type ?? ""}
                  status={source?.status ?? "unknown"}
                  target={source?.target ?? ""}
                  disabled={disabled}
                  dragging={itemDragKey === item.key}
                  marked={itemMarkIndex === itemIndex}
                  canMoveUp={itemIndex > 0}
                  canMoveDown={itemIndex < section.items.length - 1}
                  canMovePrev={sectionIndex > 0}
                  canMoveNext={sectionIndex < sectionCount - 1}
                  reorderDescribedBy={reorderDescribedBy}
                  displayDescribedBy={displayDescribedBy}
                  onDisplayName={(value) => onDisplayName(item, value)}
                  onMoveUp={() => onMoveItem(itemIndex, itemIndex - 1)}
                  onMoveDown={() => onMoveItem(itemIndex, itemIndex + 1)}
                  onMovePrev={() => onMoveItemToSection(itemIndex, -1)}
                  onMoveNext={() => onMoveItemToSection(itemIndex, 1)}
                  onRemove={() => onRemoveItem(item)}
                  onPointerDown={(event) =>
                    onPointerDown(event, "item", itemIndex, label)
                  }
                  onKeyDown={(event) =>
                    moveWithArrows(
                      event,
                      () => onMoveItem(itemIndex, itemIndex - 1),
                      () => onMoveItem(itemIndex, itemIndex + 1),
                    )
                  }
                />
              </LayoutSlot>
            );
          })}
        </ul>
      )}
      {totalMonitors === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("page_monitor_none")}
        </p>
      ) : available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("page_monitor_all_used")}
        </p>
      ) : (
        <MonitorPicker
          monitors={available}
          disabled={disabled}
          describedBy={monitorDescribedBy}
          onOpenChange={onPickerOpenChange}
          onAdd={onAddMonitor}
        />
      )}
    </LayoutArticle>
  );
}
