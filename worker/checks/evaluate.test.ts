// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { evaluateHeartbeat, evaluateHttp } from "./evaluate";

describe("evaluateHttp", () => {
  it("checks status, keyword, and a JSON path", () => {
    const body = JSON.stringify({ status: "ok" });
    expect(
      evaluateHttp({
        status: 200,
        body,
        responseMs: 12,
        expectedStatuses: [200],
        keyword: "ok",
        jsonPath: "$.status",
        jsonExpect: "ok",
      }).ok,
    ).toBe(true);
    expect(
      evaluateHttp({
        status: 500,
        body,
        responseMs: 12,
        expectedStatuses: [200],
      }).errorKind,
    ).toBe("status");
    expect(
      evaluateHttp({
        status: 200,
        body,
        responseMs: 12,
        expectedStatuses: [200],
        jsonPath: "$.status",
        jsonExpect: "down",
      }).errorKind,
    ).toBe("json");
  });
});

describe("evaluateHeartbeat", () => {
  it("fails when the push is older than the interval plus grace", () => {
    expect(evaluateHeartbeat(0, 60_000, 0, 60_001).ok).toBe(false);
    expect(evaluateHeartbeat(0, 60_000, 5_000, 64_000).ok).toBe(true);
    expect(evaluateHeartbeat(null, 60_000, 0, 1).errorKind).toBe("heartbeat");
  });
});
