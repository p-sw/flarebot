// SPDX-License-Identifier: MIT

export type MonitorStatus =
  | "up"
  | "degraded"
  | "pending"
  | "down"
  | "unknown"
  | "paused";

export type RuntimeState = {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  transitions: number[];
  flappingNotified: boolean;
  lastResponseMs: number | null;
  statusSince: number;
  lastCheckAt: number | null;
  lastError: string | null;
  /**
   * Channels were told the monitor is degraded and have not been told it
   * cleared. A failed check in between does not reset it, so a degraded
   * monitor that blips through pending is not announced twice.
   */
  degradedNotified?: boolean;
};

export type CheckOutcome = {
  ok: boolean;
  internal: boolean;
  responseMs: number;
  errorKind: string | null;
  error: string | null;
  httpStatus: number | null;
  certNotAfter?: number | null;
  /** Set on a successful check that matched a degraded condition. */
  degraded?: string | null;
};

export type Policy = {
  retries: number;
  recoveryThreshold: number;
  now: number;
};

export type TransitionResult = {
  state: RuntimeState;
  openedOutage: boolean;
  closedOutage: boolean;
  alert: "down" | "up" | "unstable" | null;
  /** Separate from alert so a recovery straight into degraded can send both. */
  degradedAlert: "degraded" | "degraded_resolved" | null;
  nextDelayMs: number | null;
};

export const RETRY_DELAY_MS = 10_000;
export const FLAP_WINDOW_MS = 30 * 60 * 1000;
export const FLAP_THRESHOLD = 3;

export function runtimeForPause(
  state: RuntimeState,
  paused: boolean,
  now: number,
): RuntimeState {
  if (paused) {
    if (state.status === "paused") return state;
    return { ...state, status: "paused", statusSince: now };
  }
  if (state.status !== "paused") return state;
  return {
    ...state,
    status: "pending",
    statusSince: now,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };
}

export function initialState(now: number): RuntimeState {
  return {
    status: "unknown",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    transitions: [],
    flappingNotified: false,
    lastResponseMs: null,
    statusSince: now,
    lastCheckAt: null,
    lastError: null,
  };
}

function noteFlip(
  state: RuntimeState,
  now: number,
  kind: "down" | "up",
): "down" | "up" | "unstable" | null {
  const windowStart = now - FLAP_WINDOW_MS;
  state.transitions = [
    ...state.transitions.filter((stamp) => stamp >= windowStart),
    now,
  ];
  if (state.transitions.length >= FLAP_THRESHOLD) {
    if (!state.flappingNotified) {
      state.flappingNotified = true;
      return "unstable";
    }
    return null;
  }
  state.flappingNotified = false;
  return kind;
}

/**
 * Up and degraded share the same failure and recovery rules. A successful
 * check that matched a degraded condition lands on degraded instead of up.
 * Degraded counts as a success for retries, outages, and flapping.
 */
export function applyOutcome(
  state: RuntimeState,
  outcome: CheckOutcome,
  policy: Policy,
): TransitionResult {
  const base = applyHealth(state, outcome, policy);
  const next = base.state;
  if (next.status === "up" && outcome.ok && outcome.degraded) {
    next.status = "degraded";
    if (state.status === "degraded") next.statusSince = state.statusSince;
    else if (state.status === "up") next.statusSince = policy.now;
  }
  let degradedAlert: TransitionResult["degradedAlert"] = null;
  const notified = state.degradedNotified === true;
  if (next.status === "degraded" && !notified) {
    next.degradedNotified = true;
    degradedAlert = "degraded";
  } else if (next.status === "up" && notified) {
    next.degradedNotified = false;
    degradedAlert = "degraded_resolved";
  } else if (next.status === "down" && notified) {
    // The down alert replaces the degraded one. Recovery sends up, not a clear.
    next.degradedNotified = false;
  }
  return { ...base, state: next, degradedAlert };
}

function applyHealth(
  state: RuntimeState,
  outcome: CheckOutcome,
  policy: Policy,
): Omit<TransitionResult, "degradedAlert"> {
  const next: RuntimeState = {
    ...state,
    transitions: [...state.transitions],
    lastCheckAt: policy.now,
    lastResponseMs: outcome.responseMs,
    lastError: outcome.error,
  };
  if (state.status === "paused") {
    return {
      state: next,
      openedOutage: false,
      closedOutage: false,
      alert: null,
      nextDelayMs: null,
    };
  }
  if (outcome.internal) {
    next.status = "unknown";
    next.consecutiveFailures = 0;
    next.consecutiveSuccesses = 0;
    if (state.status !== "unknown") next.statusSince = policy.now;
    return {
      state: next,
      openedOutage: false,
      closedOutage: false,
      alert: null,
      nextDelayMs: null,
    };
  }
  if (outcome.ok) {
    next.consecutiveFailures = 0;
    next.consecutiveSuccesses = state.consecutiveSuccesses + 1;
    if (state.status === "down" || state.status === "pending") {
      if (next.consecutiveSuccesses >= policy.recoveryThreshold) {
        const wasDown = state.status === "down";
        next.status = "up";
        next.statusSince = policy.now;
        return {
          state: next,
          openedOutage: false,
          closedOutage: wasDown,
          alert: wasDown ? noteFlip(next, policy.now, "up") : null,
          nextDelayMs: null,
        };
      }
      return {
        state: next,
        openedOutage: false,
        closedOutage: false,
        alert: null,
        nextDelayMs: null,
      };
    }
    if (state.status !== "up") next.statusSince = policy.now;
    next.status = "up";
    return {
      state: next,
      openedOutage: false,
      closedOutage: false,
      alert: null,
      nextDelayMs: null,
    };
  }

  next.consecutiveSuccesses = 0;
  next.consecutiveFailures = state.consecutiveFailures + 1;
  const needed = Math.max(1, policy.retries);
  if (state.status === "down") {
    return {
      state: next,
      openedOutage: false,
      closedOutage: false,
      alert: null,
      nextDelayMs: null,
    };
  }
  if (next.consecutiveFailures < needed) {
    if (state.status !== "pending") next.statusSince = policy.now;
    next.status = "pending";
    return {
      state: next,
      openedOutage: false,
      closedOutage: false,
      alert: null,
      nextDelayMs: RETRY_DELAY_MS,
    };
  }
  next.status = "down";
  next.statusSince = policy.now;
  return {
    state: next,
    openedOutage: true,
    closedOutage: false,
    alert: noteFlip(next, policy.now, "down"),
    nextDelayMs: null,
  };
}
