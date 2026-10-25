// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { CHECK_CONCURRENCY, CHECKS_PER_ALARM, shardCapacity } from "./capacity";

describe("shard capacity", () => {
  it("matches the free-plan example of 36 checks at 60s / 10s", () => {
    expect(shardCapacity(60, 10)).toBe(36);
    expect(shardCapacity(60, 20)).toBe(18);
  });

  it("stays inside the free subrequest and connection limits", () => {
    expect(CHECKS_PER_ALARM).toBeLessThanOrEqual(20);
    expect(CHECK_CONCURRENCY).toBeLessThanOrEqual(6);
  });
});
