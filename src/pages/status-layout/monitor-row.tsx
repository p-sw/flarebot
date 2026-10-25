// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { editorItemHeading, type LayoutItem } from "@shared/status-layout";
import { GripVertical, MoreHorizontal } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useId,
} from "react";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import { MonitorTypeIcon, monitorTypeLabel, StatusDot } from "./chrome";
export function MonitorRow({
  item,
  originalName,
  type,
  status,
  target,
  disabled,
  dragging,
  marked,
  canMoveUp,
  canMoveDown,
  canMovePrev,
  canMoveNext,
  reorderDescribedBy,
  displayDescribedBy,
  onDisplayName,
  onMoveUp,
  onMoveDown,
  onMovePrev,
  onMoveNext,
  onRemove,
  onPointerDown,
  onKeyDown,
}: {
  item: LayoutItem;
  originalName: string;
  type: string;
  status: string;
  target: string;
  disabled?: boolean;
  dragging: boolean;
  marked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMovePrev: boolean;
  canMoveNext: boolean;
  reorderDescribedBy: string;
  displayDescribedBy: string;
  onDisplayName: (value: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMovePrev: () => void;
  onMoveNext: () => void;
  onRemove: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const metaId = useId();
  const heading = editorItemHeading(originalName, item.displayName);
  const shown = heading.monitorName || t("monitor_fallback_name");
  const publicName = heading.title || t("monitor_fallback_name");
  const typeLabel = type ? monitorTypeLabel(type) : "";
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-1 rounded-lg border border-border bg-background px-1 py-1",
        dragging && "relative z-10 shadow-lg ring-1 ring-ring",
        marked && "shadow-[inset_0_2px_0_0_var(--ring)]",
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="mt-0.5 h-11 w-11 shrink-0 touch-none text-muted-foreground"
        aria-label={t("page_drag", { name: publicName })}
        aria-keyshortcuts="ArrowUp ArrowDown"
        aria-describedby={reorderDescribedBy}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </Button>
      <div className="flex min-w-0 flex-1 items-start gap-2 py-1.5 pr-1">
        <span className="mt-3">
          <StatusDot status={status} />
        </span>
        <span className="mt-2.5">
          <MonitorTypeIcon type={type} />
        </span>
        <div className="min-w-0 flex-1">
          <label className="grid min-w-0 gap-1" htmlFor={metaId}>
            <span className="sr-only">{t("page_display_name")}</span>
            <Input
              id={metaId}
              value={item.displayName}
              maxLength={120}
              disabled={disabled}
              placeholder={t("page_display_placeholder")}
              aria-describedby={`${displayDescribedBy} ${metaId}-meta`}
              className="h-10 border-transparent bg-transparent px-2 text-base shadow-none hover:border-border focus-visible:border-input focus-visible:bg-card sm:text-sm"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              onChange={(event) => onDisplayName(event.target.value)}
            />
          </label>
          <p
            id={`${metaId}-meta`}
            className="mt-1 break-words text-xs leading-5 text-muted-foreground"
          >
            <span className="font-medium text-foreground">
              {t("page_monitor_source", { name: shown })}
            </span>
            {typeLabel ? (
              <span>
                {" · "}
                {typeLabel}
              </span>
            ) : null}
            {target ? (
              <span className="break-all">
                {" · "}
                {target}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="mt-0.5 h-11 w-11 shrink-0 text-muted-foreground"
            aria-label={t("page_actions", { name: publicName })}
            disabled={disabled}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem
            className="min-h-11"
            disabled={!canMoveUp}
            onSelect={onMoveUp}
          >
            {t("page_move_up", { name: publicName })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={!canMoveDown}
            onSelect={onMoveDown}
          >
            {t("page_move_down", { name: publicName })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={!canMovePrev}
            onSelect={onMovePrev}
          >
            {t("page_move_prev", { name: publicName })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={!canMoveNext}
            onSelect={onMoveNext}
          >
            {t("page_move_next", { name: publicName })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11 text-destructive"
            disabled={disabled}
            onSelect={onRemove}
          >
            {t("page_remove", { name: publicName })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
