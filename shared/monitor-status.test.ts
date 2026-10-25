// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { visibleStatus } from "./monitor-status";

describe("visibleStatus", () => {
  it("shows paused whenever the monitor is paused", () => {
    expect(visibleStatus(true, "up")).toBe("paused");
    expect(visibleStatus(true, "down")).toBe("paused");
  });

  it("shows checking when a resume has not cleared a paused runtime yet", () => {
    expect(visibleStatus(false, "paused")).toBe("pending");
    expect(visibleStatus(false, "up")).toBe("up");
    expect(visibleStatus(false, null)).toBe("unknown");
  });
});
