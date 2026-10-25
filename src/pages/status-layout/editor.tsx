// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import {
  type LayoutItem,
  type LayoutSection,
  moveMonitor,
  moveWithin,
  nextSectionName,
  statusItemLabel,
} from "@shared/status-layout";
import { Plus } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/button";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import {
  applyReorder,
  availableMonitors,
  type DropTarget,
  dropTargetForPointer,
  type LayoutMonitor,
  originalMonitorName,
  type SectionSnap,
} from "./model";
import { SectionCard } from "./section-card";

type DragSession = {
  kind: "section" | "item";
  key: string;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  fromSection: number;
  fromIndex: number;
  active: boolean;
  snapshot: SectionSnap[];
  drop: DropTarget | null;
  stop: () => void;
};

type DragVisual = {
  key: string;
  kind: "section" | "item";
  fromSection: number;
  fromIndex: number;
  drop: DropTarget;
};

function snapshotSections(root: HTMLElement): SectionSnap[] {
  return [
    ...root.querySelectorAll<HTMLElement>("[data-section-index]"),
  ].flatMap((node) => {
    const sectionIndex = Number(node.dataset.sectionIndex);
    if (!Number.isInteger(sectionIndex)) return [];
    const box = node.getBoundingClientRect();
    const items = [
      ...node.querySelectorAll<HTMLElement>("[data-item-index]"),
    ].map((item) => {
      const itemBox = item.getBoundingClientRect();
      return { top: itemBox.top, bottom: itemBox.bottom };
    });
    return [
      {
        sectionIndex,
        top: box.top,
        bottom: box.bottom,
        items,
      },
    ];
  });
}

function sameVisual(current: DragVisual | null, next: DragVisual): boolean {
  return (
    current !== null &&
    current.key === next.key &&
    current.kind === next.kind &&
    current.fromSection === next.fromSection &&
    current.fromIndex === next.fromIndex &&
    current.drop.sectionIndex === next.drop.sectionIndex &&
    current.drop.index === next.drop.index
  );
}

export function StatusLayoutEditor({
  sections,
  monitors,
  disabled,
  onChange,
}: {
  sections: LayoutSection[];
  monitors: readonly LayoutMonitor[];
  disabled?: boolean;
  onChange: (sections: LayoutSection[]) => void;
}) {
  const reorderHintId = useId();
  const displayHintId = useId();
  const monitorHintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef(sections);
  const monitorsRef = useRef(monitors);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(Boolean(disabled));
  const dragRef = useRef<DragSession | null>(null);
  sectionsRef.current = sections;
  monitorsRef.current = monitors;
  onChangeRef.current = onChange;
  disabledRef.current = Boolean(disabled);
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const available = availableMonitors(monitors, sections);

  useEffect(() => {
    return () => dragRef.current?.stop();
  }, []);

  function itemLabel(item: LayoutItem): string {
    const original = originalMonitorName(item, monitorsRef.current);
    return (
      statusItemLabel(item.displayName, original) || t("monitor_fallback_name")
    );
  }

  function announce(name: string) {
    setAnnouncement(t("page_moved", { name }));
  }

  function moveSection(from: number, to: number) {
    const current = sectionsRef.current;
    if (disabledRef.current || to < 0 || to >= current.length || to === from)
      return;
    const name = current[from]?.name.trim() || t("page_section");
    onChangeRef.current(moveWithin(current, from, to));
    announce(name);
  }

  function moveItem(sectionIndex: number, from: number, to: number) {
    const current = sectionsRef.current;
    const items = current[sectionIndex]?.items;
    if (
      disabledRef.current ||
      !items ||
      to < 0 ||
      to >= items.length ||
      to === from
    )
      return;
    const item = items[from];
    if (!item) return;
    onChangeRef.current(
      moveMonitor(current, sectionIndex, from, sectionIndex, to),
    );
    announce(itemLabel(item));
  }

  function moveItemToSection(
    sectionIndex: number,
    itemIndex: number,
    direction: -1 | 1,
  ) {
    const current = sectionsRef.current;
    const toSection = sectionIndex + direction;
    const target = current[toSection];
    const item = current[sectionIndex]?.items[itemIndex];
    if (disabledRef.current || !target || !item) return;
    const toIndex = direction < 0 ? target.items.length : 0;
    onChangeRef.current(
      moveMonitor(current, sectionIndex, itemIndex, toSection, toIndex),
    );
    announce(itemLabel(item));
  }

  function publish(session: DragSession) {
    if (!session.drop) return;
    const next: DragVisual = {
      key: session.key,
      kind: session.kind,
      fromSection: session.fromSection,
      fromIndex: session.fromIndex,
      drop: session.drop,
    };
    setDragVisual((current) => (sameVisual(current, next) ? current : next));
  }

  function startDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    token: {
      kind: "section" | "item";
      key: string;
      label: string;
      sectionIndex: number;
      itemIndex: number;
    },
  ) {
    if (disabledRef.current || event.button !== 0 || !token.key) return;
    dragRef.current?.stop();
    const session: DragSession = {
      kind: token.kind,
      key: token.key,
      label: token.label,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromSection: token.sectionIndex,
      fromIndex: token.itemIndex,
      active: false,
      snapshot: [],
      drop: null,
      stop: () => {},
    };
    let finished = false;
    const stop = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (dragRef.current === session) dragRef.current = null;
    };
    const onMove = (native: PointerEvent) => {
      if (native.pointerId !== session.pointerId) return;
      if (disabledRef.current) {
        stop();
        setDragVisual(null);
        return;
      }
      const distance = Math.hypot(
        native.clientX - session.startX,
        native.clientY - session.startY,
      );
      if (!session.active) {
        if (distance < 6) return;
        const root = rootRef.current;
        if (!root) return;
        session.snapshot = snapshotSections(root);
        session.active = true;
      }
      session.drop = dropTargetForPointer(
        session.snapshot,
        native.clientY,
        session.kind,
        session.fromSection,
        session.fromIndex,
      );
      publish(session);
    };
    const onUp = (native: PointerEvent) => {
      if (native.pointerId !== session.pointerId) return;
      const drop = session.active ? session.drop : null;
      stop();
      setDragVisual(null);
      if (!drop || disabledRef.current) return;
      const next = applyReorder(
        sectionsRef.current,
        session.kind,
        session.fromSection,
        session.fromIndex,
        drop,
      );
      if (!next) return;
      onChangeRef.current(next);
      announce(session.label);
    };
    const onCancel = (native: PointerEvent) => {
      if (native.pointerId !== session.pointerId) return;
      stop();
      setDragVisual(null);
    };
    session.stop = stop;
    dragRef.current = session;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }

  function addSection() {
    if (disabledRef.current) return;
    const current = sectionsRef.current;
    onChangeRef.current([
      ...current,
      {
        key: crypto.randomUUID(),
        name: nextSectionName(
          current.map((section) => section.name),
          t("page_section_placeholder"),
        ),
        items: [],
      },
    ]);
  }

  return (
    <div
      ref={rootRef}
      className={cn("grid min-w-0 gap-3", dragVisual && "select-none")}
    >
      <p id={reorderHintId} className="sr-only">
        {t("page_reorder_keys")}
      </p>
      <p id={displayHintId} className="sr-only">
        {t("page_display_hint")}
      </p>
      <p id={monitorHintId} className="sr-only">
        {t("page_monitor_hint")}
      </p>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
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
          onClick={addSection}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("page_section_add")}
        </Button>
      </div>
      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
          <p className="font-medium">{t("page_layout_empty_title")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("page_layout_empty_body")}
          </p>
        </div>
      ) : null}
      {sections.map((section, sectionIndex) => {
        const itemDragKey = dragVisual?.kind === "item" ? dragVisual.key : null;
        const sectionMarked =
          dragVisual?.kind === "section" &&
          dragVisual.drop.index === sectionIndex &&
          dragVisual.fromSection !== sectionIndex;
        const append =
          dragVisual?.kind === "item" &&
          dragVisual.drop.sectionIndex === sectionIndex &&
          dragVisual.drop.index === section.items.length &&
          dragVisual.fromSection !== sectionIndex;
        const itemMarkIndex =
          dragVisual?.kind === "item" &&
          dragVisual.drop.sectionIndex === sectionIndex &&
          dragVisual.drop.index < section.items.length &&
          (dragVisual.fromSection !== sectionIndex ||
            dragVisual.drop.index !== dragVisual.fromIndex)
            ? dragVisual.drop.index
            : null;
        return (
          <SectionCard
            key={section.key}
            section={section}
            sectionIndex={sectionIndex}
            sectionCount={sections.length}
            monitors={monitors}
            available={available}
            disabled={disabled}
            dragging={
              dragVisual?.kind === "section" && dragVisual.key === section.key
            }
            marked={sectionMarked}
            append={Boolean(append)}
            itemDragKey={itemDragKey}
            itemMarkIndex={itemMarkIndex}
            pickerOpen={pickerKey === section.key}
            reorderDescribedBy={reorderHintId}
            displayDescribedBy={displayHintId}
            monitorDescribedBy={monitorHintId}
            onPickerOpenChange={(open) =>
              setPickerKey((current) =>
                open ? section.key : current === section.key ? null : current,
              )
            }
            onRename={(name) =>
              onChange(
                sections.map((entry) =>
                  entry.key === section.key ? { ...entry, name } : entry,
                ),
              )
            }
            onAskRemove={() => {
              if (section.items.length === 0) {
                onChange(sections.filter((entry) => entry.key !== section.key));
                return;
              }
              setRemoveKey(section.key);
            }}
            onMoveUp={() => moveSection(sectionIndex, sectionIndex - 1)}
            onMoveDown={() => moveSection(sectionIndex, sectionIndex + 1)}
            onAddMonitor={(monitor) =>
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
              )
            }
            onDisplayName={(item, value) =>
              onChange(
                sections.map((entry) =>
                  entry.key === section.key
                    ? {
                        ...entry,
                        items: entry.items.map((row) =>
                          row.key === item.key
                            ? { ...row, displayName: value }
                            : row,
                        ),
                      }
                    : entry,
                ),
              )
            }
            onMoveItem={(itemIndex, toIndex) =>
              moveItem(sectionIndex, itemIndex, toIndex)
            }
            onMoveItemToSection={(itemIndex, direction) =>
              moveItemToSection(sectionIndex, itemIndex, direction)
            }
            onRemoveItem={(item) =>
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
            onPointerDown={(event, kind, itemIndex, label) =>
              startDrag(event, {
                kind,
                key:
                  kind === "section"
                    ? section.key
                    : (section.items[itemIndex ?? 0]?.key ?? ""),
                label,
                sectionIndex,
                itemIndex: itemIndex ?? 0,
              })
            }
          />
        );
      })}
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
