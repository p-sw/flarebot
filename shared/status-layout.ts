// SPDX-License-Identifier: MIT

export const statusSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type LayoutItem = {
  key: string;
  id?: string;
  monitorId: string;
  monitorName: string;
  displayName: string;
};

export type LayoutSection = {
  key: string;
  name: string;
  items: LayoutItem[];
};

export type StoredStatusItem = {
  id?: string;
  monitorId: string;
  monitorName?: string;
  position: number;
  groupName: string;
  displayName: string;
};

export type StatusItemWrite = {
  id?: string;
  monitorId: string;
  position: number;
  groupName: string;
  displayName: string;
};

export function isStatusSlug(value: string): boolean {
  return (
    value.length > 0 && value.length <= 60 && statusSlugPattern.test(value)
  );
}

export function slugFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return isStatusSlug(slug) ? slug : "";
}

export function statusItemLabel(
  displayName: string,
  monitorName: string,
): string {
  const override = displayName.trim();
  if (override) return override;
  return monitorName.trim();
}

export function editorItemHeading(
  monitorName: string,
  displayName: string,
): { title: string; monitorName: string } {
  const monitor = monitorName.trim();
  const override = displayName.trim();
  return {
    title: override || monitor,
    monitorName: monitor,
  };
}

export function nextSectionName(
  names: readonly string[],
  base: string,
): string {
  const used = new Set(names.map((name) => name.trim()));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function duplicateSectionNames(
  sections: readonly LayoutSection[],
): boolean {
  const names = sections
    .filter((section) => section.items.length > 0)
    .map((section) => section.name.trim());
  return new Set(names).size !== names.length;
}

export function moveWithin<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...items];
  next.splice(to, 0, item);
  return next;
}

export function moveMonitor(
  sections: readonly LayoutSection[],
  fromSection: number,
  fromIndex: number,
  toSection: number,
  toIndex: number,
): LayoutSection[] {
  const source = sections[fromSection];
  const target = sections[toSection];
  if (!source || !target) return sections.map(cloneSection);
  if (fromSection === toSection) {
    return sections.map((section, index) =>
      index === fromSection
        ? { ...section, items: moveWithin(section.items, fromIndex, toIndex) }
        : cloneSection(section),
    );
  }
  const moving = source.items[fromIndex];
  if (!moving) return sections.map(cloneSection);
  return sections.map((section, index) => {
    if (index === fromSection) {
      return {
        ...section,
        items: section.items.filter((_, itemIndex) => itemIndex !== fromIndex),
      };
    }
    if (index === toSection) {
      const items = [...section.items];
      const indexInTarget = Math.max(0, Math.min(toIndex, items.length));
      items.splice(indexInTarget, 0, moving);
      return { ...section, items };
    }
    return cloneSection(section);
  });
}

export function sectionsFromItems(
  items: readonly StoredStatusItem[],
): LayoutSection[] {
  const sorted = [...items].sort(
    (left, right) => left.position - right.position,
  );
  const sections: LayoutSection[] = [];
  for (const item of sorted) {
    let section = sections.find((entry) => entry.name === item.groupName);
    if (!section) {
      section = {
        key: newKey(),
        name: item.groupName,
        items: [],
      };
      sections.push(section);
    }
    section.items.push({
      key: item.id || newKey(),
      id: item.id,
      monitorId: item.monitorId,
      monitorName: item.monitorName ?? "",
      displayName: item.displayName,
    });
  }
  return sections;
}

export function itemsFromSections(
  sections: readonly LayoutSection[],
): StatusItemWrite[] {
  const items: StatusItemWrite[] = [];
  let position = 0;
  for (const section of sections) {
    if (section.items.length === 0) continue;
    const groupName = section.name.trim().slice(0, 80);
    for (const item of section.items) {
      const write: StatusItemWrite = {
        monitorId: item.monitorId,
        position,
        groupName,
        displayName: item.displayName.trim().slice(0, 120),
      };
      if (item.id) write.id = item.id;
      items.push(write);
      position += 1;
    }
  }
  return items;
}

function cloneSection(section: LayoutSection): LayoutSection {
  return { ...section, items: [...section.items] };
}

function newKey(): string {
  return crypto.randomUUID();
}
