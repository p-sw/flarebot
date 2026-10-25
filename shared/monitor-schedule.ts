// SPDX-License-Identifier: MIT

/** Matches the paused horizon already used when a monitor is paused. */
export const PAUSED_CHECK_DELAY_MS = 365 * 86_400_000;

export function monitorTargetKey(type: string, config: unknown): string {
  const value =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : {};
  switch (type) {
    case "http":
      return `http:${String(value.url ?? "")}`;
    case "tcp":
      return `tcp:${String(value.host ?? "")}:${String(value.port ?? "")}`;
    case "dns":
      return `dns:${String(value.name ?? "")}:${String(value.type ?? "")}`;
    case "ssl":
      return `ssl:${String(value.host ?? "")}`;
    case "heartbeat":
      return "heartbeat";
    default:
      return `${type}:`;
  }
}

export function nextCheckAfterEdit(input: {
  now: number;
  paused: boolean;
  wasPaused: boolean;
  intervalMs: number;
  previousIntervalMs: number;
  previousNextCheckAt: number | null;
  previousTarget: string;
  nextTarget: string;
}): number {
  if (input.paused) return input.now + PAUSED_CHECK_DELAY_MS;
  if (input.wasPaused) return input.now;
  if (input.previousTarget !== input.nextTarget) return input.now;
  if (input.previousIntervalMs !== input.intervalMs) {
    const horizon = input.now + input.intervalMs;
    const previous = input.previousNextCheckAt ?? input.now;
    return Math.min(Math.max(previous, input.now), horizon);
  }
  if (
    input.previousNextCheckAt !== null &&
    input.previousNextCheckAt > input.now
  ) {
    return input.previousNextCheckAt;
  }
  return input.now;
}
