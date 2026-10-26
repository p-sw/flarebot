// SPDX-License-Identifier: MIT

import { visibleStatus } from "./monitor-status";

export const IMPACTS = ["degraded", "partial_outage", "major_outage"] as const;
export type Impact = (typeof IMPACTS)[number];

export const INCIDENT_STATUSES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const IMPACT_RANK: Record<Impact, number> = {
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

export function isImpact(value: string): value is Impact {
  return (IMPACTS as readonly string[]).includes(value);
}

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function worstImpact(impacts: readonly Impact[]): Impact | null {
  let worst: Impact | null = null;
  for (const impact of impacts) {
    if (!worst || IMPACT_RANK[impact] > IMPACT_RANK[worst]) worst = impact;
  }
  return worst;
}

/**
 * Incident impact wins over a live check and over maintenance.
 * Maintenance wins over the live check so a planned window is not shown as down.
 */
export function presentStatus(input: {
  paused: boolean;
  runtime: string | null | undefined;
  impact: Impact | null;
  maintenance: boolean;
}): string {
  if (input.impact) return input.impact;
  if (input.maintenance) return "maintenance";
  return visibleStatus(input.paused, input.runtime);
}

export type PageOverall =
  | "operational"
  | "degraded"
  | "outage"
  | "empty"
  | "paused"
  | "maintenance";

function isSevere(status: string): boolean {
  return status === "down" || status === "major_outage";
}

function isMild(status: string): boolean {
  return status === "degraded" || status === "partial_outage";
}

export function pageOverall(statuses: readonly string[]): PageOverall {
  if (statuses.length === 0) return "empty";
  const active = statuses.filter((status) => status !== "paused");
  if (active.length === 0) return "paused";
  if (active.some(isSevere)) {
    return active.every(isSevere) ? "outage" : "degraded";
  }
  if (active.some(isMild)) return "degraded";
  if (active.every((status) => status === "maintenance")) return "maintenance";
  return "operational";
}

export function latestByPostedAt<
  T extends { postedAt: number; createdAt: number },
>(updates: readonly T[]): T | null {
  let latest: T | null = null;
  for (const update of updates) {
    if (
      !latest ||
      update.postedAt > latest.postedAt ||
      (update.postedAt === latest.postedAt &&
        update.createdAt > latest.createdAt)
    ) {
      latest = update;
    }
  }
  return latest;
}
