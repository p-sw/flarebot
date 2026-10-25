// SPDX-License-Identifier: AGPL-3.0-only

/**
 * v1 maintenance windows will suppress alerts and exclude checks from uptime.
 * The scheduler already calls this so the later rule can land in one place.
 */
export function isInMaintenance(_monitorId: string, _now: number): boolean {
  return false;
}
