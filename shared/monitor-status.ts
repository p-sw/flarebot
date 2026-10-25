// SPDX-License-Identifier: MIT

const known = new Set(["up", "down", "pending", "unknown"]);

export function visibleStatus(
  paused: boolean,
  runtime: string | null | undefined,
): string {
  if (paused) return "paused";
  if (runtime === "paused") return "pending";
  if (runtime && known.has(runtime)) return runtime;
  return "unknown";
}
