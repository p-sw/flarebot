// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  type CheckOutcome,
  degradedNotifyEnabled,
  initialState,
  type Policy,
  type RuntimeState,
  runtimeForPause,
  type TransitionResult,
} from "./state-machine";

const up: CheckOutcome = {
  ok: true,
  internal: false,
  responseMs: 40,
  errorKind: null,
  error: null,
  httpStatus: 200,
  degraded: null,
};

const slow: CheckOutcome = {
  ...up,
  responseMs: 900,
  degraded: "Response time was over the degraded limit",
};

const down: CheckOutcome = {
  ok: false,
  internal: false,
  responseMs: 1000,
  errorKind: "timeout",
  error: "timeout",
  httpStatus: null,
};

const internal: CheckOutcome = {
  ...down,
  internal: true,
  errorKind: "internal",
  error: "Unsupported monitor type",
};

type Step = { outcome: CheckOutcome; notify?: boolean };

/** Runs checks one minute apart and returns every transition. */
function run(
  start: RuntimeState,
  steps: (CheckOutcome | Step)[],
  policy: Partial<Policy> = {},
): TransitionResult[] {
  const { degradedNotify = true, ...rest } = policy;
  let state = start;
  return steps.map((entry, index) => {
    const step = "outcome" in entry ? entry : { outcome: entry };
    const result = applyOutcome(state, step.outcome, {
      retries: 0,
      recoveryThreshold: 1,
      now: (index + 1) * 60_000,
      ...rest,
      degradedNotify: step.notify ?? degradedNotify,
    });
    state = result.state;
    return result;
  });
}

function upState(): RuntimeState {
  return { ...initialState(0), status: "up", consecutiveSuccesses: 3 };
}

function alerts(results: TransitionResult[]) {
  return results.flatMap((result) =>
    [result.alert, result.degradedAlert].filter(Boolean),
  );
}

describe("degraded status", () => {
  it("moves up to degraded and back without retries", () => {
    const [entered, cleared] = run(upState(), [slow, up], { retries: 3 });
    expect(entered?.state.status).toBe("degraded");
    expect(entered?.nextDelayMs).toBeNull();
    expect(cleared?.state.status).toBe("up");
  });

  it("restarts statusSince on entry and on clear, and keeps it while degraded", () => {
    const [entered, still, cleared] = run(upState(), [slow, slow, up]);
    expect(entered?.state.statusSince).toBe(60_000);
    expect(still?.state.statusSince).toBe(60_000);
    expect(cleared?.state.statusSince).toBe(180_000);
  });

  it("keeps up when the check passes with no matching condition", () => {
    const [result] = run(upState(), [up]);
    expect(result?.state.status).toBe("up");
    expect(result?.degradedAlert).toBeNull();
  });

  it("does not open or close an outage on up and degraded swaps", () => {
    const results = run(upState(), [slow, up, slow]);
    for (const result of results) {
      expect(result.openedOutage).toBe(false);
      expect(result.closedOutage).toBe(false);
      expect(result.alert).toBeNull();
    }
  });

  it("goes pending then down from degraded with the usual retries", () => {
    const [entered, pending, confirmed] = run(upState(), [slow, down, down], {
      retries: 2,
    });
    expect(entered?.state.status).toBe("degraded");
    expect(pending?.state.status).toBe("pending");
    expect(pending?.nextDelayMs).toBe(10_000);
    expect(confirmed?.state.status).toBe("down");
    expect(confirmed?.openedOutage).toBe(true);
    expect(confirmed?.alert).toBe("down");
  });

  it("does not let a degraded marker on a failed check change down or pending", () => {
    const failedButMarked: CheckOutcome = { ...down, degraded: "ignored" };
    const [pending, confirmed] = run(upState(), [failedButMarked, down], {
      retries: 2,
    });
    expect(pending?.state.status).toBe("pending");
    expect(pending?.degradedAlert).toBeNull();
    expect(confirmed?.state.status).toBe("down");
    expect(confirmed?.degradedAlert).toBeNull();
  });

  it("keeps pending while recovery needs more successes, even if degraded", () => {
    const start: RuntimeState = {
      ...initialState(0),
      status: "down",
      consecutiveFailures: 2,
    };
    const [first, second] = run(start, [slow, slow], { recoveryThreshold: 2 });
    expect(first?.state.status).toBe("down");
    expect(first?.degradedAlert).toBeNull();
    expect(second?.state.status).toBe("degraded");
    expect(second?.closedOutage).toBe(true);
  });

  it("sends recovery and then the degraded alert when down recovers into degraded", () => {
    const start: RuntimeState = {
      ...initialState(0),
      status: "down",
      consecutiveFailures: 2,
    };
    const [recovered] = run(start, [slow]);
    expect(recovered?.state.status).toBe("degraded");
    expect(recovered?.closedOutage).toBe(true);
    expect(recovered?.alert).toBe("up");
    expect(recovered?.degradedAlert).toBe("degraded");
  });

  it("does not count up and degraded swaps toward flapping", () => {
    const results = run(upState(), [slow, up, slow, up, slow, up, slow]);
    expect(results.at(-1)?.state.transitions).toEqual([]);
    expect(results.at(-1)?.state.flappingNotified).toBe(false);
    expect(results.map((result) => result.alert)).toEqual(Array(7).fill(null));
  });

  it("enters degraded on the first check from unknown", () => {
    const [first] = run(initialState(0), [slow]);
    expect(first?.state.status).toBe("degraded");
    expect(first?.degradedAlert).toBe("degraded");
    expect(first?.state.degradedNotified).toBe(true);
  });

  it("does not move a paused monitor into degraded", () => {
    const paused = runtimeForPause(upState(), true, 0);
    const [result] = run(paused, [slow]);
    expect(result?.state.status).toBe("paused");
    expect(result?.degradedAlert).toBeNull();
  });

  it("drops to unknown on an internal error and keeps the alert flag", () => {
    const [entered, broken, cleared] = run(upState(), [slow, internal, up]);
    expect(entered?.state.degradedNotified).toBe(true);
    expect(broken?.state.status).toBe("unknown");
    expect(broken?.degradedAlert).toBeNull();
    expect(broken?.state.degradedNotified).toBe(true);
    expect(cleared?.state.status).toBe("up");
    expect(cleared?.degradedAlert).toBe("degraded_resolved");
  });
});

describe("degraded alerts", () => {
  it("sends one entry and one clear across repeated degraded checks", () => {
    const results = run(upState(), [slow, slow, slow, up, up]);
    expect(results.map((result) => result.degradedAlert)).toEqual([
      "degraded",
      null,
      null,
      "degraded_resolved",
      null,
    ]);
    expect(results.at(-1)?.state.degradedNotified).toBe(false);
  });

  it("sends a new entry each time the monitor becomes degraded again", () => {
    const results = run(upState(), [slow, up, slow, slow, up]);
    expect(alerts(results)).toEqual([
      "degraded",
      "degraded_resolved",
      "degraded",
      "degraded_resolved",
    ]);
  });

  it("sends nothing and keeps the flag clear when alerts are off", () => {
    const results = run(upState(), [slow, slow, up], { degradedNotify: false });
    expect(alerts(results)).toEqual([]);
    expect(results.map((result) => result.state.status)).toEqual([
      "degraded",
      "degraded",
      "up",
    ]);
    for (const result of results)
      expect(result.state.degradedNotified ?? false).toBe(false);
  });

  it("treats a missing degradedNotify policy as on", () => {
    const result = applyOutcome(upState(), slow, {
      retries: 0,
      recoveryThreshold: 1,
      now: 1,
    });
    expect(result.degradedAlert).toBe("degraded");
  });

  it("sends the clear after the conditions are removed", () => {
    // Without conditions the check never carries a degraded marker.
    const results = run(upState(), [
      { outcome: slow },
      { outcome: { ...up, degraded: undefined }, notify: false },
    ]);
    expect(alerts(results)).toEqual(["degraded", "degraded_resolved"]);
  });

  it("sends the clear after alerts were turned off while degraded", () => {
    const results = run(upState(), [
      { outcome: slow, notify: true },
      { outcome: slow, notify: false },
      { outcome: up, notify: false },
    ]);
    expect(results.map((result) => result.degradedAlert)).toEqual([
      "degraded",
      null,
      "degraded_resolved",
    ]);
  });

  it("starts with the entry when alerts are turned on while degraded", () => {
    const results = run(upState(), [
      { outcome: slow, notify: false },
      { outcome: slow, notify: true },
      { outcome: up, notify: true },
    ]);
    expect(results.map((result) => result.degradedAlert)).toEqual([
      null,
      "degraded",
      "degraded_resolved",
    ]);
  });

  it("sends no clear when alerts were off for the whole episode", () => {
    const results = run(upState(), [
      { outcome: slow, notify: false },
      { outcome: up, notify: true },
    ]);
    expect(alerts(results)).toEqual([]);
  });

  it("does not repeat the entry after a pending blip", () => {
    const results = run(upState(), [slow, down, slow, up], { retries: 2 });
    expect(results.map((result) => result.state.status)).toEqual([
      "degraded",
      "pending",
      "degraded",
      "up",
    ]);
    expect(results.map((result) => result.degradedAlert)).toEqual([
      "degraded",
      null,
      null,
      "degraded_resolved",
    ]);
    expect(results[1]?.state.degradedNotified).toBe(true);
  });

  it("clears with degraded_resolved when a pending blip returns to up", () => {
    const results = run(upState(), [slow, down, up], { retries: 2 });
    expect(results.map((result) => result.degradedAlert)).toEqual([
      "degraded",
      null,
      "degraded_resolved",
    ]);
  });

  it("replaces the degraded alert with down and recovers with up, not a clear", () => {
    const results = run(upState(), [slow, down, up]);
    expect(
      results.map((result) => [result.alert, result.degradedAlert]),
    ).toEqual([
      [null, "degraded"],
      ["down", null],
      ["up", null],
    ]);
    expect(results[1]?.state.degradedNotified).toBe(false);
  });

  it("does not repeat the entry after pause and resume", () => {
    const [entered] = run(upState(), [slow]);
    if (!entered) throw new Error("missing transition");
    const paused = runtimeForPause(entered.state, true, 100_000);
    const resumed = runtimeForPause(paused, false, 200_000);
    expect(resumed.status).toBe("pending");
    expect(resumed.degradedNotified).toBe(true);
    const results = run(resumed, [slow, slow, up]);
    expect(results.map((result) => result.degradedAlert)).toEqual([
      null,
      null,
      "degraded_resolved",
    ]);
  });
});

describe("degraded alerts while flapping", () => {
  // Known gap, reported with this test. The unstable notice says further
  // alerts are paused until the monitor settles. Down and up alerts pause,
  // but a monitor flapping between down and degraded still sends a degraded
  // entry on every recovery, because down clears degradedNotified.
  it.fails("pauses degraded entry alerts after the unstable notice", () => {
    const results = run(upState(), [down, slow, down, slow, down, slow]);
    expect(results.map((result) => result.alert)).toEqual([
      "down",
      "up",
      "unstable",
      null,
      null,
      null,
    ]);
    const afterNotice = results.slice(3).map((result) => result.degradedAlert);
    expect(afterNotice).toEqual([null, null, null]);
  });
});

describe("degradedNotifyEnabled", () => {
  it.each([
    [null, false],
    ["text", false],
    [{}, false],
    [{ degraded: null }, false],
    [{ degraded: "yes" }, false],
    [{ degraded: {} }, true],
    [{ degraded: { notify: true } }, true],
    [{ degraded: { notify: false } }, false],
    [{ degraded: { notify: "false" } }, true],
  ])("reads %j as %s", (config, enabled) => {
    expect(degradedNotifyEnabled(config)).toBe(enabled);
  });
});
