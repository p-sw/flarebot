// SPDX-License-Identifier: MIT

import type { LayoutSection } from "@shared/status-layout";
import { describe, expect, it } from "vitest";
import {
  applyReorder,
  availableMonitors,
  dropTargetForPointer,
  filterMonitors,
  type LayoutMonitor,
  originalMonitorName,
  reorderTarget,
  type SectionSnap,
} from "./model";

const monitors: LayoutMonitor[] = [
  {
    id: "alpha",
    name: "Alpha API",
    type: "http",
    status: "up",
    target: "https://alpha.example/health",
  },
  {
    id: "beta",
    name: "Beta edge",
    type: "tcp",
    status: "pending",
    target: "edge.example:443",
  },
  {
    id: "pulse",
    name: "Heartbeat push",
    type: "heartbeat",
    status: "up",
    target: "",
  },
];

function section(name: string, ids: string[]): LayoutSection {
  return {
    key: name,
    name,
    items: ids.map((id) => ({
      key: id,
      monitorId: id,
      monitorName: monitors.find((monitor) => monitor.id === id)?.name ?? "",
      displayName: "",
    })),
  };
}

describe("status layout picker model", () => {
  it("keeps the catalog name when the stored monitor name is blank", () => {
    expect(
      originalMonitorName({ monitorId: "alpha", monitorName: "  " }, monitors),
    ).toBe("Alpha API");
    expect(
      originalMonitorName(
        { monitorId: "alpha", monitorName: "Saved name" },
        monitors,
      ),
    ).toBe("Saved name");
    expect(
      originalMonitorName({ monitorId: "missing", monitorName: "" }, monitors),
    ).toBe("");
  });

  it("hides monitors already placed on the page and matches name, type, or target", () => {
    const open = availableMonitors(monitors, [section("Edge", ["alpha"])]);
    expect(open.map((monitor) => monitor.id)).toEqual(["beta", "pulse"]);
    const matched = filterMonitors(open, "EDGE.EXAMPLE", (monitor) =>
      [monitor.name, monitor.type ?? "", monitor.target ?? ""].join(" "),
    );
    expect(matched.map((monitor) => monitor.id)).toEqual(["beta"]);
    expect(
      filterMonitors(open, "   ", (monitor) => monitor.name).map(
        (monitor) => monitor.id,
      ),
    ).toEqual(["beta", "pulse"]);
  });
});

describe("status layout reorder", () => {
  const snaps: SectionSnap[] = [
    {
      sectionIndex: 0,
      top: 0,
      bottom: 200,
      items: [
        { top: 100, bottom: 140 },
        { top: 140, bottom: 180 },
      ],
    },
    {
      sectionIndex: 1,
      top: 220,
      bottom: 400,
      items: [{ top: 240, bottom: 280 }],
    },
  ];

  it("resolves a drop inside the same section and across sections", () => {
    expect(reorderTarget(snaps[0]?.items ?? [], 0, 160)).toBe(1);
    expect(reorderTarget(snaps[0]?.items ?? [], 0, 20)).toBe(0);
    const across = dropTargetForPointer(snaps, 250, "item", 0, 0);
    expect(across).toEqual({ sectionIndex: 1, index: 0 });
    const ontoHeader = dropTargetForPointer(snaps, 230, "item", 0, 1);
    expect(ontoHeader).toEqual({ sectionIndex: 1, index: 0 });
    const sectionMove = dropTargetForPointer(snaps, 10, "section", 1, 0);
    expect(sectionMove).toEqual({ sectionIndex: 1, index: 0 });
  });

  it("applies a monitor move and ignores a drop on the same slot", () => {
    const sections = [section("Edge", ["alpha"]), section("Core", ["beta"])];
    expect(
      applyReorder(sections, "item", 0, 0, { sectionIndex: 0, index: 0 }),
    ).toBe(null);
    const moved = applyReorder(sections, "item", 1, 0, {
      sectionIndex: 0,
      index: 0,
    });
    expect(moved?.[0]?.items.map((item) => item.monitorId)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(moved?.[1]?.items).toEqual([]);
    const reordered = applyReorder(sections, "section", 1, 0, {
      sectionIndex: 1,
      index: 0,
    });
    expect(reordered?.map((entry) => entry.name)).toEqual(["Core", "Edge"]);
  });
});
