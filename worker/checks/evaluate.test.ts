// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  classifyFetchError,
  evaluateHeartbeat,
  evaluateHttp,
} from "./evaluate";

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
    expect(evaluateHeartbeat(0, 60_000, 5_000, 65_001).error).toBe(
      "Heartbeat missed",
    );
  });
});

describe("evaluateHttp keywords", () => {
  it("rejects a missing keyword, a forbidden keyword, and invalid JSON", () => {
    expect(
      evaluateHttp({
        status: 200,
        body: "up",
        responseMs: 1,
        expectedStatuses: [200],
        keyword: "down",
        keywordMode: "absent",
      }).ok,
    ).toBe(true);
    expect(
      evaluateHttp({
        status: 200,
        body: "down",
        responseMs: 1,
        expectedStatuses: [200],
        keyword: "down",
        keywordMode: "absent",
      }).errorKind,
    ).toBe("keyword");
    expect(
      evaluateHttp({
        status: 200,
        body: "nope",
        responseMs: 1,
        expectedStatuses: [200],
        jsonPath: "$.ok",
      }).error,
    ).toBe("Response was not JSON");
  });
});

describe("classifyFetchError", () => {
  it("maps timeout, DNS, and TLS failures", () => {
    expect(
      classifyFetchError(new Error("The operation was aborted")).errorKind,
    ).toBe("timeout");
    expect(
      classifyFetchError(new Error("getaddrinfo ENOTFOUND")).errorKind,
    ).toBe("dns");
    expect(
      classifyFetchError(new Error("TLS handshake failed")).errorKind,
    ).toBe("tls");
    expect(classifyFetchError(new Error("connection refused")).errorKind).toBe(
      "connect",
    );
  });
});
