// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { runtimeFromRow } from "./persist";
import {
  applyOutcome,
  type CheckOutcome,
  degradedNotifyEnabled,
  FLAP_WINDOW_MS,
  initialState,
  type Policy,
  type RuntimeState,
  runtimeForPause,
  type TransitionResult,
} from "./state-machine";

const MINUTE = 60_000;

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
  // The unstable notice says further alerts pause until the monitor settles.
  // All six checks fit in one flap window, so the entry stays paused too.
  it("pauses degraded entry alerts after the unstable notice", () => {
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
    for (const result of results.slice(2))
      expect(result.state.degradedNotified ?? false).toBe(false);
  });

  /**
   * Checks once a minute from minute 0 through `until`. Each check returns
   * the outcome of the latest change at or before that minute. The monitor
   * is up before minute 0.
   */
  function minutes(
    changes: Record<number, CheckOutcome>,
    until: number,
  ): Map<number, TransitionResult> {
    const results = new Map<number, TransitionResult>();
    let state = upState();
    let outcome = up;
    for (let minute = 0; minute <= until; minute += 1) {
      outcome = changes[minute] ?? outcome;
      const result = applyOutcome(state, outcome, {
        retries: 0,
        recoveryThreshold: 1,
        now: minute * MINUTE,
        degradedNotify: true,
      });
      results.set(minute, result);
      state = result.state;
    }
    return results;
  }

  /** Every alert that went out, with its minute. */
  function sent(results: Map<number, TransitionResult>) {
    return [...results].flatMap(([minute, result]) =>
      [result.alert, result.degradedAlert]
        .filter((alert) => alert !== null)
        .map((alert) => [minute, alert]),
    );
  }

  function flagAt(results: Map<number, TransitionResult>, minute: number) {
    return results.get(minute)?.state.degradedNotified ?? false;
  }

  // Down at 0, degraded at 5, down at 10 (unstable), degraded at 15.
  const flapping = { 0: down, 5: slow, 10: down, 15: slow };
  const beforePause = [
    [0, "down"],
    [5, "up"],
    [5, "degraded"],
    [10, "unstable"],
  ];

  it("sends nothing from the unstable notice until the flips leave the window", () => {
    const results = minutes({ ...flapping, 37: down, 39: up }, 39);
    expect(sent(results)).toEqual(beforePause);
    expect(results.get(15)?.state.status).toBe("degraded");
    expect(results.get(36)?.state.status).toBe("degraded");
    expect(results.get(37)?.state.status).toBe("down");
    expect(results.get(37)?.openedOutage).toBe(true);
    expect(results.get(39)?.state.status).toBe("up");
    expect(results.get(39)?.closedOutage).toBe(true);
    for (let minute = 10; minute <= 39; minute += 1)
      expect(flagAt(results, minute), `minute ${minute}`).toBe(false);
  });

  it("sends the entry once when one flip is left in the window, then the clear", () => {
    const results = minutes({ ...flapping, 37: down, 38: slow, 70: up }, 72);
    expect(sent(results)).toEqual([
      ...beforePause,
      [68, "degraded"],
      [70, "degraded_resolved"],
    ]);
    expect(flagAt(results, 67)).toBe(false);
    expect(flagAt(results, 68)).toBe(true);
    expect(flagAt(results, 69)).toBe(true);
    expect(flagAt(results, 70)).toBe(false);
  });

  it("resumes while still degraded, then down replaces the entry and up follows", () => {
    const results = minutes({ ...flapping, 45: down, 47: up }, 50);
    expect(sent(results)).toEqual([
      ...beforePause,
      [41, "degraded"],
      [45, "down"],
      [47, "up"],
    ]);
    expect(flagAt(results, 40)).toBe(false);
    expect(flagAt(results, 41)).toBe(true);
    expect(flagAt(results, 45)).toBe(false);
    expect(results.get(45)?.state.flappingNotified).toBe(false);
    expect(results.get(47)?.state.status).toBe("up");
  });

  const now = 100 * MINUTE;

  function settledDegraded(
    transitions: number[],
    flappingNotified: boolean,
  ): RuntimeState {
    return {
      ...upState(),
      status: "degraded",
      transitions,
      flappingNotified,
      degradedNotified: false,
    };
  }

  it.each([
    ["two flips in the window", null, [now - 20 * MINUTE, now - MINUTE]],
    [
      "a flip exactly on the window start",
      null,
      [now - FLAP_WINDOW_MS, now - MINUTE],
    ],
    [
      "one flip in the window",
      "degraded",
      [now - FLAP_WINDOW_MS - 1, now - MINUTE],
    ],
    [
      "one flip in the window after older ones",
      "degraded",
      [now - 50 * MINUTE, now - 40 * MINUTE, now - MINUTE],
    ],
    ["no flips in the window", "degraded", [now - 40 * MINUTE]],
    ["no flips recorded", "degraded", []],
  ] as const)(
    "after the unstable notice, %s gives entry %s",
    (_label, entry, transitions) => {
      const result = applyOutcome(
        settledDegraded([...transitions], true),
        slow,
        { retries: 0, recoveryThreshold: 1, now, degradedNotify: true },
      );
      expect(result.state.status).toBe("degraded");
      expect(result.degradedAlert).toBe(entry);
      expect(result.state.degradedNotified ?? false).toBe(entry !== null);
    },
  );

  it("does not pause the entry before the unstable notice", () => {
    const result = applyOutcome(
      settledDegraded([now - 2 * MINUTE, now - MINUTE], false),
      slow,
      { retries: 0, recoveryThreshold: 1, now, degradedNotify: true },
    );
    expect(result.degradedAlert).toBe("degraded");
  });

  it("sends the entry on the first degraded check after a D1 reload", () => {
    // runtimeFromRow keeps the stored flapping flag but not the flip stamps.
    const reloaded = runtimeFromRow(
      {
        monitorId: "m",
        status: "degraded",
        since: now - 10 * MINUTE,
        lastResponseMs: 900,
        lastCheckAt: now - MINUTE,
        consecutiveFailures: 0,
        consecutiveSuccesses: 3,
        lastError: null,
        flapping: true,
        degradedNotified: false,
      },
      now,
    );
    expect(reloaded.transitions).toEqual([]);
    expect(reloaded.flappingNotified).toBe(true);
    const result = applyOutcome(reloaded, slow, {
      retries: 0,
      recoveryThreshold: 1,
      now,
      degradedNotify: true,
    });
    expect(result.degradedAlert).toBe("degraded");
    expect(result.state.degradedNotified).toBe(true);
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
