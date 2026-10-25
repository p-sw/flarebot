// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { applyOutcome, type CheckOutcome, initialState } from "./state-machine";

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
});
