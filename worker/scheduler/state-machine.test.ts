// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  type CheckOutcome,
  initialState,
  runtimeForPause,
} from "./state-machine";

const fail = (error = "timeout"): CheckOutcome => ({
  ok: false,
  internal: false,
  responseMs: 1000,
  errorKind: "timeout",
  error,
  httpStatus: null,
});

const ok: CheckOutcome = {
  ok: true,
  internal: false,
  responseMs: 40,
  errorKind: null,
  error: null,
  httpStatus: 200,
};

describe("applyOutcome", () => {
  it("confirms DOWN only after the configured failures", () => {
    const first = applyOutcome(initialState(0), fail(), {
      retries: 2,
      recoveryThreshold: 1,
      now: 0,
    });
    expect(first.state.status).toBe("pending");
    expect(first.alert).toBeNull();
    expect(first.nextDelayMs).toBe(10_000);
    const second = applyOutcome(first.state, fail("status"), {
      retries: 2,
      recoveryThreshold: 1,
      now: 10_000,
    });
    expect(second.state.status).toBe("down");
    expect(second.openedOutage).toBe(true);
    expect(second.alert).toBe("down");
  });

  it("recovers after one success and closes the outage", () => {
    let state = initialState(0);
    state = applyOutcome(state, fail(), {
      retries: 2,
      recoveryThreshold: 1,
      now: 0,
    }).state;
    state = applyOutcome(state, fail(), {
      retries: 2,
      recoveryThreshold: 1,
      now: 10_000,
    }).state;
    const recovered = applyOutcome(state, ok, {
      retries: 2,
      recoveryThreshold: 1,
      now: 20_000,
    });
    expect(recovered.state.status).toBe("up");
    expect(recovered.closedOutage).toBe(true);
    expect(recovered.alert).toBe("up");
  });

  it("records an internal failure as UNKNOWN and does not alert", () => {
    const result = applyOutcome(
      initialState(0),
      { ...fail(), internal: true, ok: false },
      {
        retries: 2,
        recoveryThreshold: 1,
        now: 0,
      },
    );
    expect(result.state.status).toBe("unknown");
    expect(result.alert).toBeNull();
    expect(result.openedOutage).toBe(false);
  });

  it("collapses flaps inside 30 minutes into one unstable alert", () => {
    let state = initialState(0);
    state = {
      ...applyOutcome(state, fail(), {
        retries: 1,
        recoveryThreshold: 1,
        now: 0,
      }).state,
    };
    const up = applyOutcome(state, ok, {
      retries: 1,
      recoveryThreshold: 1,
      now: 1_000,
    });
    const down = applyOutcome(up.state, fail(), {
      retries: 1,
      recoveryThreshold: 1,
      now: 2_000,
    });
    expect(down.alert).toBe("unstable");
    const again = applyOutcome(down.state, ok, {
      retries: 1,
      recoveryThreshold: 1,
      now: 3_000,
    });
    expect(again.alert).toBeNull();
  });

  it("waits for the recovery threshold before closing an outage", () => {
    const state = applyOutcome(initialState(0), fail(), {
      retries: 1,
      recoveryThreshold: 2,
      now: 0,
    }).state;
    const first = applyOutcome(state, ok, {
      retries: 1,
      recoveryThreshold: 2,
      now: 1_000,
    });
    expect(first.state.status).toBe("down");
    expect(first.closedOutage).toBe(false);
    const second = applyOutcome(first.state, ok, {
      retries: 1,
      recoveryThreshold: 2,
      now: 2_000,
    });
    expect(second.state.status).toBe("up");
    expect(second.closedOutage).toBe(true);
  });

  it("does not alert again while the monitor stays down", () => {
    const down = applyOutcome(initialState(0), fail(), {
      retries: 1,
      recoveryThreshold: 1,
      now: 0,
    });
    const again = applyOutcome(down.state, fail(), {
      retries: 1,
      recoveryThreshold: 1,
      now: 1_000,
    });
    expect(again.alert).toBeNull();
    expect(again.openedOutage).toBe(false);
  });

  it("accepts the next check after a resume clears paused", () => {
    const paused = runtimeForPause(
      { ...initialState(0), status: "up" },
      true,
      5,
    );
    expect(paused.status).toBe("paused");
    const resumed = runtimeForPause(paused, false, 10);
    expect(resumed.status).toBe("pending");
    expect(resumed.consecutiveFailures).toBe(0);
    const checked = applyOutcome(resumed, ok, {
      retries: 2,
      recoveryThreshold: 1,
      now: 11,
    });
    expect(checked.state.status).toBe("up");
  });

  it("ignores checks while paused and drops old flap stamps", () => {
    const paused = applyOutcome(
      { ...initialState(0), status: "paused" },
      fail(),
      { retries: 1, recoveryThreshold: 1, now: 1 },
    );
    expect(paused.alert).toBeNull();
    expect(paused.state.status).toBe("paused");

    const stale = applyOutcome(
      {
        ...initialState(0),
        status: "up",
        transitions: [0],
        flappingNotified: true,
      },
      fail(),
      { retries: 1, recoveryThreshold: 1, now: 31 * 60_000 },
    );
    expect(stale.alert).toBe("down");
    expect(stale.state.flappingNotified).toBe(false);
  });

  it("does not close an outage when a pending monitor recovers", () => {
    const pending = applyOutcome(initialState(0), fail(), {
      retries: 3,
      recoveryThreshold: 1,
      now: 0,
    });
    const recovered = applyOutcome(pending.state, ok, {
      retries: 3,
      recoveryThreshold: 1,
      now: 1_000,
    });
    expect(recovered.state.status).toBe("up");
    expect(recovered.closedOutage).toBe(false);
    expect(recovered.alert).toBeNull();
  });

  it("closes the outage and sends up after down passed through unknown", () => {
    const policy = { retries: 1, recoveryThreshold: 1 };
    const down = applyOutcome(initialState(0), fail(), { ...policy, now: 0 });
    expect(down.openedOutage).toBe(true);
    const unknown = applyOutcome(
      down.state,
      { ...ok, ok: false, internal: true, error: "lookup failed" },
      { ...policy, now: 60_000 },
    );
    expect(unknown.state.status).toBe("unknown");
    expect(unknown.closedOutage).toBe(false);
    const up = applyOutcome(unknown.state, ok, { ...policy, now: 120_000 });
    expect(up.state.status).toBe("up");
    expect(up.closedOutage).toBe(true);
    expect(up.alert).toBe("up");
    const steady = applyOutcome(up.state, ok, { ...policy, now: 180_000 });
    expect(steady.closedOutage).toBe(false);
    expect(steady.alert).toBeNull();
  });

  it("closes the outage after a pause and resume, and does not open a second one", () => {
    const policy = { retries: 1, recoveryThreshold: 1 };
    const down = applyOutcome(initialState(0), fail(), { ...policy, now: 0 });
    const resumed = runtimeForPause(
      runtimeForPause(down.state, true, 1_000),
      false,
      2_000,
    );
    expect(resumed.status).toBe("pending");
    const again = applyOutcome(resumed, fail(), { ...policy, now: 3_000 });
    expect(again.state.status).toBe("down");
    expect(again.openedOutage).toBe(false);
    expect(again.alert).toBeNull();
    const up = applyOutcome(
      runtimeForPause(runtimeForPause(again.state, true, 4_000), false, 5_000),
      ok,
      { ...policy, now: 6_000 },
    );
    expect(up.state.status).toBe("up");
    expect(up.closedOutage).toBe(true);
    expect(up.alert).toBe("up");
  });

  it("treats a stored down state without the flag as an open outage", () => {
    const legacy = { ...initialState(0), status: "down" as const };
    const up = applyOutcome(legacy, ok, {
      retries: 1,
      recoveryThreshold: 1,
      now: 1_000,
    });
    expect(up.closedOutage).toBe(true);
    expect(up.alert).toBe("up");
  });
});
