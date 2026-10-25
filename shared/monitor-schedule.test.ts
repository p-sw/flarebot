// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  monitorTargetKey,
  nextCheckAfterEdit,
  PAUSED_CHECK_DELAY_MS,
} from "./monitor-schedule";

const now = 1_700_000_000_000;

describe("nextCheckAfterEdit", () => {
  const base = {
    now,
    paused: false,
    wasPaused: false,
    intervalMs: 60_000,
    previousIntervalMs: 60_000,
    previousNextCheckAt: now + 30_000,
    previousTarget: "http:https://example.com/old",
    nextTarget: "http:https://example.com/old",
  };

  it("checks a new target immediately", () => {
    expect(
      nextCheckAfterEdit({
        ...base,
        nextTarget: "http:https://example.com/new",
      }),
    ).toBe(now);
  });

  it("pulls a later alarm forward to the new interval", () => {
    expect(
      nextCheckAfterEdit({
        ...base,
        intervalMs: 120_000,
        previousIntervalMs: 3_600_000,
        previousNextCheckAt: now + 3_600_000,
      }),
    ).toBe(now + 120_000);
  });

  it("keeps a sooner alarm that already fits the new interval", () => {
    expect(
      nextCheckAfterEdit({
        ...base,
        intervalMs: 120_000,
        previousIntervalMs: 60_000,
        previousNextCheckAt: now + 30_000,
      }),
    ).toBe(now + 30_000);
  });

  it("keeps the existing alarm when the schedule did not change", () => {
    expect(nextCheckAfterEdit(base)).toBe(now + 30_000);
  });

  it("uses the paused horizon and checks immediately on resume", () => {
    expect(nextCheckAfterEdit({ ...base, paused: true })).toBe(
      now + PAUSED_CHECK_DELAY_MS,
    );
    expect(nextCheckAfterEdit({ ...base, wasPaused: true })).toBe(now);
  });
});

describe("monitorTargetKey", () => {
  it("identifies the address that a check actually contacts", () => {
    expect(
      monitorTargetKey("http", { url: "https://example.com/health" }),
    ).toBe("http:https://example.com/health");
    expect(monitorTargetKey("tcp", { host: "1.1.1.1", port: 443 })).toBe(
      "tcp:1.1.1.1:443",
    );
    expect(monitorTargetKey("dns", { name: "example.com", type: "A" })).toBe(
      "dns:example.com:A",
    );
    expect(monitorTargetKey("ssl", { host: "example.com" })).toBe(
      "ssl:example.com",
    );
    expect(monitorTargetKey("heartbeat", { graceSeconds: 30 })).toBe(
      "heartbeat",
    );
  });
});
