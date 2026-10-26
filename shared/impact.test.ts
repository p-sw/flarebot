// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  latestByPostedAt,
  pageOverall,
  presentStatus,
  worstImpact,
} from "./impact";

describe("impact", () => {
  it("lets an incident override a live failure and maintenance", () => {
    expect(
      presentStatus({
        paused: false,
        runtime: "down",
        impact: "degraded",
        maintenance: true,
      }),
    ).toBe("degraded");
    expect(
      presentStatus({
        paused: false,
        runtime: "down",
        impact: null,
        maintenance: true,
      }),
    ).toBe("maintenance");
    expect(
      presentStatus({
        paused: true,
        runtime: "up",
        impact: null,
        maintenance: false,
      }),
    ).toBe("paused");
  });

  it("rolls component states into a page overall", () => {
    expect(pageOverall([])).toBe("empty");
    expect(pageOverall(["paused", "paused"])).toBe("paused");
    expect(pageOverall(["major_outage", "major_outage"])).toBe("outage");
    expect(pageOverall(["down", "up"])).toBe("degraded");
    expect(pageOverall(["partial_outage", "up"])).toBe("degraded");
    expect(pageOverall(["maintenance", "maintenance"])).toBe("maintenance");
    expect(pageOverall(["maintenance", "up"])).toBe("operational");
    expect(worstImpact(["degraded", "major_outage", "partial_outage"])).toBe(
      "major_outage",
    );
  });

  it("picks the latest timeline update", () => {
    const latest = latestByPostedAt([
      { id: "a", postedAt: 10, createdAt: 1 },
      { id: "b", postedAt: 10, createdAt: 2 },
      { id: "c", postedAt: 9, createdAt: 3 },
    ]);
    expect(latest?.id).toBe("b");
  });
});
