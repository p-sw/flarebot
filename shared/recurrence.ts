// SPDX-License-Identifier: MIT

import { DAY_MS } from "./history";

export const RECURRENCES = ["once", "daily", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Longest window the scheduler will honor. Longer ranges are rejected. */
export const MAX_WINDOW_MS = 14 * DAY_MS;

export type CivilDate = { year: number; month: number; day: number };

export type ZonedParts = CivilDate & {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday, in the given timezone. */
  weekday: number;
};

export type MaintenanceSchedule = {
  startAt: number;
  endAt: number;
  timezone: string;
  recurrence: Recurrence;
  /** Weekdays for `weekly`. 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  cancelledAt: number | null;
};

export type Occurrence = { start: number; end: number };

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isRecurrence(value: string): value is Recurrence {
  return (RECURRENCES as readonly string[]).includes(value);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function windowDuration(schedule: MaintenanceSchedule): number {
  return schedule.endAt - schedule.startAt;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: WEEKDAYS[read("weekday")] ?? 0,
  };
}

function offsetAt(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - ms;
}

/**
 * Wall-clock time in `timeZone` as UTC milliseconds.
 * A spring-forward gap resolves to the instant after the gap.
 * A fall-back overlap resolves to the earlier offset.
 */
export function zonedTimeToUtc(
  date: CivilDate & { hour: number; minute: number; second: number },
  timeZone: string,
): number {
  const guess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    date.hour,
    date.minute,
    date.second,
  );
  const first = offsetAt(guess, timeZone);
  let utc = guess - first;
  const second = offsetAt(utc, timeZone);
  if (first !== second) utc = guess - second;
  return utc;
}

export function formatLocalInput(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseLocalInput(
  value: string,
  timeZone: string,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return zonedTimeToUtc(
    { year, month, day, hour, minute, second: 0 },
    timeZone,
  );
}

function addDays(date: CivilDate, days: number): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function compareDate(left: CivilDate, right: CivilDate): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clip(
  schedule: MaintenanceSchedule,
  occurrence: Occurrence,
): Occurrence | null {
  if (schedule.cancelledAt == null) return occurrence;
  if (occurrence.start >= schedule.cancelledAt) return null;
  const end = Math.min(occurrence.end, schedule.cancelledAt);
  if (end <= occurrence.start) return null;
  return { start: occurrence.start, end };
}

function matches(schedule: MaintenanceSchedule, date: CivilDate): boolean {
  const start = zonedParts(schedule.startAt, schedule.timezone);
  if (compareDate(date, start) < 0) return false;
  if (schedule.recurrence === "once") return compareDate(date, start) === 0;
  if (schedule.recurrence === "daily") return true;
  if (schedule.recurrence === "weekly") {
    return schedule.weekdays.includes(weekdayOf(date));
  }
  const wanted = Math.min(start.day, daysInMonth(date.year, date.month));
  return date.day === wanted;
}

function startOn(
  schedule: MaintenanceSchedule,
  date: CivilDate,
): number | null {
  if (!matches(schedule, date)) return null;
  const start = zonedParts(schedule.startAt, schedule.timezone);
  if (compareDate(date, start) === 0) return schedule.startAt;
  return zonedTimeToUtc(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: start.hour,
      minute: start.minute,
      second: start.second,
    },
    schedule.timezone,
  );
}

export function occurrenceContaining(
  schedule: MaintenanceSchedule,
  now: number,
): Occurrence | null {
  const duration = windowDuration(schedule);
  if (duration <= 0 || duration > MAX_WINDOW_MS) return null;
  if (now < schedule.startAt) return null;
  if (schedule.cancelledAt != null && now >= schedule.cancelledAt) return null;
  if (schedule.recurrence === "once") {
    if (now < schedule.startAt || now >= schedule.endAt) return null;
    return clip(schedule, { start: schedule.startAt, end: schedule.endAt });
  }
  const lookback = Math.ceil(duration / DAY_MS) + 2;
  const today = zonedParts(now, schedule.timezone);
  for (let back = lookback; back >= 0; back -= 1) {
    const start = startOn(schedule, addDays(today, -back));
    if (start == null) continue;
    const occurrence = clip(schedule, { start, end: start + duration });
    if (!occurrence) continue;
    if (now >= occurrence.start && now < occurrence.end) return occurrence;
  }
  return null;
}

export function nextOccurrences(
  schedule: MaintenanceSchedule,
  from: number,
  count: number,
): Occurrence[] {
  const duration = windowDuration(schedule);
  if (count <= 0 || duration <= 0 || duration > MAX_WINDOW_MS) return [];
  const found: Occurrence[] = [];
  const active = occurrenceContaining(schedule, from);
  if (active) found.push(active);
  const origin = zonedParts(
    Math.max(from, schedule.startAt),
    schedule.timezone,
  );
  const scan = schedule.recurrence === "once" ? 1 : 400;
  for (let index = 0; index < scan && found.length < count; index += 1) {
    const start = startOn(schedule, addDays(origin, index));
    if (start == null) continue;
    const occurrence = clip(schedule, { start, end: start + duration });
    if (!occurrence || occurrence.end <= from) continue;
    if (found.some((item) => item.start === occurrence.start)) continue;
    found.push(occurrence);
  }
  return found.slice(0, count);
}

export function classifySchedule(
  schedule: MaintenanceSchedule,
  now: number,
): "active" | "upcoming" | "past" {
  if (occurrenceContaining(schedule, now)) return "active";
  const next = nextOccurrences(schedule, now, 1)[0];
  if (next && next.start > now) return "upcoming";
  return "past";
}

export function timeZoneNames(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const names = intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  return names.includes("UTC") ? names : ["UTC", ...names];
}
