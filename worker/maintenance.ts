// SPDX-License-Identifier: MIT

import {
  isRecurrence,
  type MaintenanceSchedule,
  occurrenceContaining,
} from "../shared/recurrence";

type ActiveRow = {
  start_at: number;
  end_at: number;
  timezone: string;
  recurrence: string;
  weekdays_json: string;
  cancelled_at: number | null;
  monitor_id: string;
};

const ACTIVE_WINDOWS = `SELECT w.start_at, w.end_at, w.timezone, w.recurrence,
  w.weekdays_json, w.cancelled_at, m.monitor_id
FROM maintenance_windows w
INNER JOIN maintenance_monitors m ON m.maintenance_id = w.id
WHERE w.start_at <= ?
  AND (w.cancelled_at IS NULL OR w.cancelled_at > ?)
  AND (w.recurrence != 'once' OR w.end_at > ?)`;

function weekdaysOf(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is number =>
        typeof item === "number" && item >= 0 && item <= 6,
    );
  } catch {
    return [];
  }
}

export function scheduleFromRow(row: {
  startAt: number;
  endAt: number;
  timezone: string;
  recurrence: string;
  weekdaysJson: string;
  cancelledAt: number | null;
}): MaintenanceSchedule | null {
  if (!isRecurrence(row.recurrence)) return null;
  return {
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    recurrence: row.recurrence,
    weekdays: weekdaysOf(row.weekdaysJson),
    cancelledAt: row.cancelledAt,
  };
}

/**
 * One D1 read per alarm. The shard passes the set into the check loop so a
 * window suppresses alerts and marks samples without a query per monitor.
 */
export async function loadActiveMaintenanceIds(
  database: D1Database,
  now: number,
): Promise<Set<string>> {
  const result = await database
    .prepare(ACTIVE_WINDOWS)
    .bind(now, now, now)
    .all<ActiveRow>();
  const ids = new Set<string>();
  for (const row of result.results) {
    const schedule = scheduleFromRow({
      startAt: row.start_at,
      endAt: row.end_at,
      timezone: row.timezone,
      recurrence: row.recurrence,
      weekdaysJson: row.weekdays_json,
      cancelledAt: row.cancelled_at,
    });
    if (!schedule) continue;
    if (occurrenceContaining(schedule, now)) ids.add(row.monitor_id);
  }
  return ids;
}

export function isInMaintenance(
  monitorId: string,
  active: ReadonlySet<string>,
): boolean {
  return active.has(monitorId);
}
