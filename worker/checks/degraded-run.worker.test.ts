// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./run";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const base = {
  type: "http" as const,
  timeoutMs: 5_000,
  intervalMs: 60_000,
  lastPushAt: null,
  now: 1_000,
};

function http(degraded: Record<string, unknown>, extra = {}) {
  return {
    url: "https://gallery.example/api/status/proxy",
    method: "GET",
    followRedirects: true,
    expectedStatuses: [200],
    keywordMode: "present",
    degraded: { keywordMode: "present", notify: true, ...degraded },
    ...extra,
  };
}

/** A body that records whether the check read it or released it. */
function trackedBody(text: string, delayMs = 0) {
  const seen = { pulled: false, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      seen.pulled = true;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

function respond(body: BodyInit | null, status = 200, headerDelayMs = 0) {
  globalThis.fetch = (async () => {
    if (headerDelayMs)
      await new Promise((resolve) => setTimeout(resolve, headerDelayMs));
    return new Response(body, { status });
  }) as typeof fetch;
}

describe("runCheck with degraded conditions", () => {
  it("reads the body for a degraded keyword alone", async () => {
    const { stream, seen } = trackedBody('{"status":"degraded"}');
    respond(stream);
    const outcome = await runCheck({
      ...base,
      config: http({ keyword: "degraded" }),
    });
    expect(seen.pulled).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBe("Degraded keyword was found");
  });

  it("reads the body for an absent-mode degraded keyword and finds it", async () => {
    respond("all systems ok");
    const outcome = await runCheck({
      ...base,
      config: http({ keyword: "ok", keywordMode: "absent" }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBeNull();
  });

  it("reads the body for a degraded JSON path alone", async () => {
    respond('{"status":"degraded","proxies":2}');
    const outcome = await runCheck({
      ...base,
      config: http({ jsonPath: "$.status", jsonExpect: "degraded" }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBe("Degraded JSON value matched");
  });

  it("does not wait for the body when only a response-time limit is set", async () => {
    // A body that never ends. Reading it would stall the check.
    respond(
      new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }),
    );
    const outcome = await Promise.race([
      runCheck({ ...base, config: http({ maxResponseMs: 5_000 }) }),
      new Promise<"stalled">((resolve) =>
        setTimeout(() => resolve("stalled"), 2_000),
      ),
    ]);
    expect(outcome).not.toBe("stalled");
    if (outcome === "stalled") return;
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBeNull();
  });

  it("marks a response slower than the limit as degraded", async () => {
    respond("ok", 200, 120);
    const outcome = await runCheck({
      ...base,
      config: http({ maxResponseMs: 50 }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.responseMs).toBeGreaterThan(50);
    expect(outcome.degraded).toBe("Response time was over the degraded limit");
  });

  it("does not count body read time toward the degraded limit", async () => {
    const { stream } = trackedBody("all fine", 200);
    respond(stream);
    const outcome = await runCheck({
      ...base,
      config: http({ keyword: "never-there", maxResponseMs: 100 }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.responseMs).toBeLessThanOrEqual(100);
    expect(outcome.degraded).toBeNull();
  });

  it("does not mark a failed check degraded", async () => {
    respond("degraded", 503);
    const outcome = await runCheck({
      ...base,
      config: http({ keyword: "degraded", maxResponseMs: 1 }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorKind).toBe("status");
    expect(outcome.degraded).toBeUndefined();
  });

  it("keeps the health assertions in charge of up and down", async () => {
    respond('{"status":"degraded"}');
    const outcome = await runCheck({
      ...base,
      config: http(
        { jsonPath: "$.status", jsonExpect: "degraded" },
        { jsonPath: "$.status", jsonExpect: "ok" },
      ),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("JSON value did not match");
    expect(outcome.degraded).toBeUndefined();
  });
});
