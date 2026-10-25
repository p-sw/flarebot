// SPDX-License-Identifier: AGPL-3.0-only

import type { CheckOutcome } from "../scheduler/state-machine";
import { jsonValuesEqual, readJsonPath } from "./json-path";

export function failure(
  errorKind: string,
  error: string,
  responseMs = 0,
  httpStatus: number | null = null,
): CheckOutcome {
  return {
    ok: false,
    internal: false,
    responseMs,
    errorKind,
    error,
    httpStatus,
  };
}

export function success(
  responseMs: number,
  httpStatus: number | null = null,
): CheckOutcome {
  return {
    ok: true,
    internal: false,
    responseMs,
    errorKind: null,
    error: null,
    httpStatus,
  };
}

export function internalFailure(error: string): CheckOutcome {
  return {
    ok: false,
    internal: true,
    responseMs: 0,
    errorKind: "internal",
    error,
    httpStatus: null,
  };
}

export function evaluateHttp(input: {
  status: number;
  body: string;
  responseMs: number;
  expectedStatuses: number[];
  keyword?: string;
  keywordMode?: "present" | "absent";
  jsonPath?: string;
  jsonExpect?: string;
}): CheckOutcome {
  if (!input.expectedStatuses.includes(input.status)) {
    return failure(
      "status",
      `Unexpected status ${input.status}`,
      input.responseMs,
      input.status,
    );
  }
  if (input.keyword) {
    const present = input.body.includes(input.keyword);
    const mode = input.keywordMode ?? "present";
    if (mode === "present" && !present) {
      return failure(
        "keyword",
        "Keyword was not found",
        input.responseMs,
        input.status,
      );
    }
    if (mode === "absent" && present) {
      return failure(
        "keyword",
        "Forbidden keyword was found",
        input.responseMs,
        input.status,
      );
    }
  }
  if (input.jsonPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.body);
    } catch {
      return failure(
        "json",
        "Response was not JSON",
        input.responseMs,
        input.status,
      );
    }
    const read = readJsonPath(parsed, input.jsonPath);
    if (!read.ok)
      return failure("json", read.error, input.responseMs, input.status);
    if (
      input.jsonExpect !== undefined &&
      !jsonValuesEqual(read.value, input.jsonExpect)
    ) {
      return failure(
        "json",
        "JSON value did not match",
        input.responseMs,
        input.status,
      );
    }
  }
  return success(input.responseMs, input.status);
}

export function evaluateHeartbeat(
  lastPushAt: number | null,
  intervalMs: number,
  graceMs: number,
  now: number,
): CheckOutcome {
  if (lastPushAt === null)
    return failure("heartbeat", "No heartbeat received yet");
  if (now - lastPushAt > intervalMs + graceMs)
    return failure("heartbeat", "Heartbeat missed");
  return success(0);
}

export function classifyFetchError(error: unknown): CheckOutcome {
  const message = error instanceof Error ? error.message : "Request failed";
  const lower = message.toLowerCase();
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return failure("timeout", "Timed out");
  }
  if (
    lower.includes("dns") ||
    lower.includes("enotfound") ||
    lower.includes("name not resolved")
  ) {
    return failure("dns", "DNS lookup failed");
  }
  if (
    lower.includes("cert") ||
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("handshake")
  ) {
    return failure("tls", "TLS handshake failed");
  }
  return failure("connect", message.slice(0, 300));
}
