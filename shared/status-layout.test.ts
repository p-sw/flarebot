// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  duplicateSectionNames,
  itemsFromSections,
  type LayoutSection,
  moveMonitor,
  moveWithin,
  nextSectionName,
  sectionsFromItems,
  slugFromTitle,
  statusItemLabel,
} from "./status-layout";

describe("statusItemLabel", () => {
  it("uses the monitor name when the display name is blank", () => {
    expect(statusItemLabel("", "Named probe")).toBe("Named probe");
    expect(statusItemLabel("   ", "Named probe")).toBe("Named probe");
  });

  it("prefers a display name override over the monitor name", () => {
    expect(statusItemLabel("Edge API", "Named probe")).toBe("Edge API");
  });

  it("does not invent a label from a section name", () => {
    expect(statusItemLabel("", "")).toBe("");
    expect(statusItemLabel("", "Named probe")).not.toBe("Core");
  });
});

describe("status page layout", () => {
  const monitors = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Alpha" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Beta" },
  ];

  function section(
    name: string,
    items: { monitorId: string; displayName?: string }[],
  ): LayoutSection {
    return {
      key: name,
      name,
      items: items.map((item) => ({
        key: item.monitorId,
        monitorId: item.monitorId,
        monitorName:
          monitors.find((monitor) => monitor.id === item.monitorId)?.name ?? "",
        displayName: item.displayName ?? "",
      })),
    };
  }

  it("suggests a slug from the title and rejects an empty result", () => {
    expect(slugFromTitle("API Status")).toBe("api-status");
    expect(slugFromTitle("  Status!!! ")).toBe("status");
    expect(slugFromTitle("---")).toBe("");
  });

  it("keeps section order and monitor order in positions", () => {
    const sections = [
      section("Edge", [{ monitorId: monitors[0]?.id ?? "" }]),
      section("Core", [
        { monitorId: monitors[1]?.id ?? "", displayName: "Public beta" },
      ]),
    ];
    const moved = moveMonitor(moveWithin(sections, 1, 0), 0, 0, 0, 1);
    expect(moved.map((entry) => entry.name)).toEqual(["Core", "Edge"]);
    const items = itemsFromSections(moved);
    expect(items.map((item) => item.groupName)).toEqual(["Core", "Edge"]);
    expect(items.map((item) => item.position)).toEqual([0, 1]);
    expect(items[0]?.displayName).toBe("Public beta");
    expect(statusItemLabel(items[1]?.displayName ?? "", "Alpha")).toBe("Alpha");
  });

  it("moves a monitor into another section without losing the rest", () => {
    const sections = [
      section("Edge", [{ monitorId: monitors[0]?.id ?? "" }]),
      section("Core", [{ monitorId: monitors[1]?.id ?? "" }]),
    ];
    const moved = moveMonitor(sections, 1, 0, 0, 0);
    expect(moved[0]?.items.map((item) => item.monitorName)).toEqual([
      "Beta",
      "Alpha",
    ]);
    expect(moved[1]?.items).toEqual([]);
  });

  it("rebuilds sections from stored positions and keeps an override", () => {
    const sections = sectionsFromItems([
      {
        id: "11111111-1111-4111-8111-111111111111",
        monitorId: monitors[1]?.id ?? "",
        monitorName: "Beta",
        position: 1,
        groupName: "Core",
        displayName: "",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        monitorId: monitors[0]?.id ?? "",
        monitorName: "Alpha",
        position: 0,
        groupName: "Edge",
        displayName: "Edge API",
      },
    ]);
    expect(sections.map((entry) => entry.name)).toEqual(["Edge", "Core"]);
    expect(sections[0]?.items[0]?.displayName).toBe("Edge API");
    expect(sections[0]?.items[0]?.monitorName).toBe("Alpha");
    expect(duplicateSectionNames(sections)).toBe(false);
    expect(nextSectionName(["Edge", "Core"], "Section")).toBe("Section");
    expect(nextSectionName(["Section", "Section 2"], "Section")).toBe(
      "Section 3",
    );
  });
});
