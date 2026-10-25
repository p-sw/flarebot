// SPDX-License-Identifier: AGPL-3.0-only

export type MonitorStatus = "up" | "pending" | "down" | "unknown" | "paused";

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
};

export type CheckOutcome = {
  ok: boolean;
  internal: boolean;
  responseMs: number;
  errorKind: string | null;
  error: string | null;
  httpStatus: number | null;
  certNotAfter?: number | null;
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
  nextDelayMs: number | null;
};

export const RETRY_DELAY_MS = 10_000;
export const FLAP_WINDOW_MS = 30 * 60 * 1000;
export const FLAP_THRESHOLD = 3;

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

export function applyOutcome(
  state: RuntimeState,
  outcome: CheckOutcome,
  policy: Policy,
): TransitionResult {
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
