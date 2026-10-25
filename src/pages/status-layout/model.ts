// SPDX-License-Identifier: MIT

import {
  type LayoutSection,
  moveMonitor,
  moveWithin,
} from "@shared/status-layout";

export type LayoutMonitor = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  target?: string;
};

export type Rect = { top: number; bottom: number };

export type SectionSnap = {
  sectionIndex: number;
  top: number;
  bottom: number;
  items: Rect[];
};

export type DropTarget = { sectionIndex: number; index: number };

export function originalMonitorName(
  item: { monitorId: string; monitorName: string },
  monitors: readonly { id: string; name: string }[],
): string {
  const stored = item.monitorName.trim();
  if (stored) return stored;
  return (
    monitors.find((monitor) => monitor.id === item.monitorId)?.name.trim() ?? ""
  );
}

export function availableMonitors(
  monitors: readonly LayoutMonitor[],
  sections: readonly { items: readonly { monitorId: string }[] }[],
): LayoutMonitor[] {
  const used = new Set(
    sections.flatMap((section) => section.items.map((item) => item.monitorId)),
  );
  return monitors.filter((monitor) => !used.has(monitor.id));
}

export function filterMonitors(
  monitors: readonly LayoutMonitor[],
  query: string,
  textOf: (monitor: LayoutMonitor) => string,
): LayoutMonitor[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...monitors];
  return monitors.filter((monitor) =>
    textOf(monitor).toLowerCase().includes(needle),
  );
}

export function insertionIndex(
  rects: readonly Rect[],
  clientY: number,
): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect) continue;
    const mid = (rect.top + rect.bottom) / 2;
    if (clientY < mid) return index;
  }
  return rects.length;
}

export function sameListDestination(from: number, insertAt: number): number {
  if (insertAt > from) return insertAt - 1;
  return insertAt;
}

export function reorderTarget(
  rects: readonly Rect[],
  from: number,
  clientY: number,
): number {
  const to = sameListDestination(from, insertionIndex(rects, clientY));
  if (rects.length === 0) return 0;
  if (to < 0) return 0;
  if (to >= rects.length) return rects.length - 1;
  return to;
}

export function sectionAtPointer(
  snaps: readonly SectionSnap[],
  clientY: number,
): SectionSnap | null {
  const first = snaps[0];
  if (!first) return null;
  let chosen = first;
  for (const snap of snaps) {
    if (clientY < snap.top) break;
    chosen = snap;
    if (clientY <= snap.bottom) return snap;
  }
  return chosen;
}

export function dropTargetForPointer(
  snaps: readonly SectionSnap[],
  clientY: number,
  kind: "section" | "item",
  fromSection: number,
  fromIndex: number,
): DropTarget | null {
  if (snaps.length === 0) return null;
  if (kind === "section") {
    const rects = snaps.map((snap) => ({ top: snap.top, bottom: snap.bottom }));
    return {
      sectionIndex: fromSection,
      index: reorderTarget(rects, fromSection, clientY),
    };
  }
  const section = sectionAtPointer(snaps, clientY);
  if (!section) return null;
  if (section.sectionIndex === fromSection) {
    return {
      sectionIndex: section.sectionIndex,
      index: reorderTarget(section.items, fromIndex, clientY),
    };
  }
  return {
    sectionIndex: section.sectionIndex,
    index: insertionIndex(section.items, clientY),
  };
}

export function applyReorder(
  sections: readonly LayoutSection[],
  kind: "section" | "item",
  fromSection: number,
  fromIndex: number,
  drop: DropTarget,
): LayoutSection[] | null {
  if (kind === "section") {
    if (drop.index === fromSection) return null;
    return moveWithin(sections, fromSection, drop.index);
  }
  if (drop.sectionIndex === fromSection && drop.index === fromIndex)
    return null;
  return moveMonitor(
    sections,
    fromSection,
    fromIndex,
    drop.sectionIndex,
    drop.index,
  );
}
