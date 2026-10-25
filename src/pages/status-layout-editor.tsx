// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import {
  type LayoutSection,
  moveMonitor,
  moveWithin,
  nextSectionName,
} from "@shared/status-layout";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { controlClass, Field } from "./fields";

type DragToken = {
  kind: "section" | "item";
  section: number;
  item: number | null;
};

function itemLabel(name: string, displayName: string): string {
  const override = displayName.trim();
  if (override) return override;
  if (name.trim()) return name.trim();
  return t("monitor_fallback_name");
}

export function StatusLayoutEditor({
  sections,
  monitors,
  disabled,
  onChange,
}: {
  sections: LayoutSection[];
  monitors: { id: string; name: string }[];
  disabled?: boolean;
  onChange: (sections: LayoutSection[]) => void;
}) {
  const drag = useRef<DragToken | null>(null);
  const [active, setActive] = useState<DragToken | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const used = new Set(
    sections.flatMap((section) => section.items.map((item) => item.monitorId)),
  );
  const available = monitors.filter((monitor) => !used.has(monitor.id));

  function start(event: PointerEvent<HTMLButtonElement>, token: DragToken) {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = token;
    setActive(token);
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const token = drag.current;
    drag.current = null;
    setActive(null);
    if (!token || disabled) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const sectionNode = target?.closest("[data-section-index]");
    if (!sectionNode) return;
    const sectionIndex = Number(sectionNode.getAttribute("data-section-index"));
    if (!Number.isInteger(sectionIndex)) return;
    if (token.kind === "section") {
      onChange(moveWithin(sections, token.section, sectionIndex));
      return;
    }
    const itemNode = target?.closest("[data-item-index]");
    const itemIndex = itemNode
      ? Number(itemNode.getAttribute("data-item-index"))
      : (sections[sectionIndex]?.items.length ?? 0);
    onChange(
      moveMonitor(
        sections,
        token.section,
        token.item ?? 0,
        sectionIndex,
        itemIndex,
      ),
    );
  }

  function sectionTitle(section: LayoutSection): string {
    return section.name.trim() || t("page_section");
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-medium">{t("page_layout")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("page_layout_hint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...sections,
              {
                key: crypto.randomUUID(),
                name: nextSectionName(
                  sections.map((section) => section.name),
                  t("page_section_placeholder"),
                ),
                items: [],
              },
            ])
          }
        >
          {t("page_section_add")}
        </Button>
      </div>
      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("page_section_empty")}
        </p>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <article
          key={section.key}
          data-section-index={sectionIndex}
          className={`grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3 ${
            active?.kind === "section" && active.section === sectionIndex
              ? "opacity-70"
              : ""
          }`}
        >
          <div className="grid min-w-0 gap-2">
            <div className="min-w-0">
              <Field
                label={t("page_section_name")}
                hint={t("page_section_hint")}
              >
                <Input
                  value={section.name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      sections.map((entry) =>
                        entry.key === section.key
                          ? { ...entry, name: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </Field>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 touch-none"
                aria-label={t("page_drag", { name: sectionTitle(section) })}
                disabled={disabled}
                onPointerDown={(event) =>
                  start(event, {
                    kind: "section",
                    section: sectionIndex,
                    item: null,
                  })
                }
                onPointerUp={finish}
                onPointerCancel={() => {
                  drag.current = null;
                  setActive(null);
                }}
              >
                <GripVertical className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label={t("page_move_up", { name: sectionTitle(section) })}
                disabled={disabled || sectionIndex === 0}
                onClick={() =>
                  onChange(moveWithin(sections, sectionIndex, sectionIndex - 1))
                }
              >
                <ChevronUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label={t("page_move_down", {
                  name: sectionTitle(section),
                })}
                disabled={disabled || sectionIndex === sections.length - 1}
                onClick={() =>
                  onChange(moveWithin(sections, sectionIndex, sectionIndex + 1))
                }
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  if (section.items.length === 0) {
                    onChange(
                      sections.filter((entry) => entry.key !== section.key),
                    );
                    return;
                  }
                  setRemoveKey(section.key);
                }}
              >
                {t("page_section_delete")}
              </Button>
            </div>
          </div>
          {section.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("page_section_empty")}
            </p>
          ) : (
            <ul className="grid min-w-0 gap-2">
              {section.items.map((item, itemIndex) => {
                const label = itemLabel(item.monitorName, item.displayName);
                return (
                  <li
                    key={item.key}
                    data-item-index={itemIndex}
                    className={`grid min-w-0 gap-2 rounded-lg border border-border p-2 ${
                      active?.kind === "item" &&
                      active.section === sectionIndex &&
                      active.item === itemIndex
                        ? "opacity-70"
                        : ""
                    }`}
                  >
                    <div className="grid min-w-0 gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 touch-none"
                          aria-label={t("page_drag", { name: label })}
                          disabled={disabled}
                          onPointerDown={(event) =>
                            start(event, {
                              kind: "item",
                              section: sectionIndex,
                              item: itemIndex,
                            })
                          }
                          onPointerUp={finish}
                          onPointerCancel={() => {
                            drag.current = null;
                            setActive(null);
                          }}
                        >
                          <GripVertical className="h-4 w-4" aria-hidden />
                        </Button>
                        <p className="min-w-0 flex-1 break-words text-sm font-medium">
                          {label}
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          aria-label={t("page_move_up", { name: label })}
                          disabled={disabled || itemIndex === 0}
                          onClick={() =>
                            onChange(
                              moveMonitor(
                                sections,
                                sectionIndex,
                                itemIndex,
                                sectionIndex,
                                itemIndex - 1,
                              ),
                            )
                          }
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          aria-label={t("page_move_down", { name: label })}
                          disabled={
                            disabled || itemIndex === section.items.length - 1
                          }
                          onClick={() =>
                            onChange(
                              moveMonitor(
                                sections,
                                sectionIndex,
                                itemIndex,
                                sectionIndex,
                                itemIndex + 1,
                              ),
                            )
                          }
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t("page_move_prev", { name: label })}
                          disabled={disabled || sectionIndex === 0}
                          onClick={() =>
                            onChange(
                              moveMonitor(
                                sections,
                                sectionIndex,
                                itemIndex,
                                sectionIndex - 1,
                                sections[sectionIndex - 1]?.items.length ?? 0,
                              ),
                            )
                          }
                        >
                          {t("page_move_prev_short")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t("page_move_next", { name: label })}
                          disabled={
                            disabled || sectionIndex === sections.length - 1
                          }
                          onClick={() =>
                            onChange(
                              moveMonitor(
                                sections,
                                sectionIndex,
                                itemIndex,
                                sectionIndex + 1,
                                0,
                              ),
                            )
                          }
                        >
                          {t("page_move_next_short")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t("page_remove", { name: label })}
                          disabled={disabled}
                          onClick={() =>
                            onChange(
                              sections.map((entry) =>
                                entry.key === section.key
                                  ? {
                                      ...entry,
                                      items: entry.items.filter(
                                        (row) => row.key !== item.key,
                                      ),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        >
                          {t("page_remove_short")}
                        </Button>
                      </div>
                    </div>
                    <Field
                      label={t("page_display_name")}
                      hint={t("page_display_hint")}
                    >
                      <Input
                        value={item.displayName}
                        maxLength={120}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange(
                            sections.map((entry) =>
                              entry.key === section.key
                                ? {
                                    ...entry,
                                    items: entry.items.map((row) =>
                                      row.key === item.key
                                        ? {
                                            ...row,
                                            displayName: event.target.value,
                                          }
                                        : row,
                                    ),
                                  }
                                : entry,
                            ),
                          )
                        }
                      />
                    </Field>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <Field
                label={t("page_monitor_pick")}
                hint={t("page_monitor_hint")}
              >
                <select
                  className={controlClass}
                  value={pick[section.key] ?? ""}
                  disabled={disabled || available.length === 0}
                  onChange={(event) =>
                    setPick((current) => ({
                      ...current,
                      [section.key]: event.target.value,
                    }))
                  }
                >
                  <option value="">{t("page_monitor_pick")}</option>
                  {available.map((monitor) => (
                    <option key={monitor.id} value={monitor.id}>
                      {monitor.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !(pick[section.key] ?? "")}
              onClick={() => {
                const monitorId = pick[section.key] ?? "";
                const monitor = monitors.find((row) => row.id === monitorId);
                if (!monitor) return;
                onChange(
                  sections.map((entry) =>
                    entry.key === section.key
                      ? {
                          ...entry,
                          items: [
                            ...entry.items,
                            {
                              key: crypto.randomUUID(),
                              monitorId: monitor.id,
                              monitorName: monitor.name,
                              displayName: "",
                            },
                          ],
                        }
                      : entry,
                  ),
                );
                setPick((current) => ({ ...current, [section.key]: "" }));
              }}
            >
              {t("page_monitor_add")}
            </Button>
          </div>
          {monitors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("page_monitor_none")}
            </p>
          ) : available.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("page_monitor_all_used")}
            </p>
          ) : null}
        </article>
      ))}
      <ConfirmDialog
        open={removeKey !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveKey(null);
        }}
        title={t("page_section_delete_title")}
        description={t("page_section_delete_body")}
        confirmLabel={t("page_section_delete")}
        cancelLabel={t("action_cancel")}
        onConfirm={() => {
          onChange(sections.filter((entry) => entry.key !== removeKey));
          setRemoveKey(null);
        }}
      />
    </div>
  );
}
