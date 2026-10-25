// SPDX-License-Identifier: AGPL-3.0-only

/** Free-plan cap: 6 in-flight connections, and well under 50 subrequests per alarm. */
export const CHECKS_PER_ALARM = 12;
export const CHECK_CONCURRENCY = 6;

export function shardCapacity(
  intervalSeconds: number,
  timeoutSeconds: number,
): number {
  const intervalMs = intervalSeconds * 1000;
  const timeoutMs = Math.max(1000, timeoutSeconds * 1000);
  return Math.max(1, Math.floor((6 * intervalMs) / timeoutMs));
}
