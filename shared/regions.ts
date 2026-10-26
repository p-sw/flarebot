// SPDX-License-Identifier: MIT

/**
 * Check placement.
 *
 * The global choice lives in `settings` under `check_region`. Missing means
 * `auto` (no location hint), which is how an existing installation behaves.
 *
 * `monitors.regions_json` is the per-monitor choice. `["default"]` is inherit,
 * the value already stored on every row. Any other single entry is `auto` or
 * one Durable Object location hint. The snapshot stores the resolved region.
 *
 * Shard names: `shard-<n>` is automatic (the existing `shard-0` stays put).
 * Every other region uses `<region>-<n>`. A hint is passed only for those.
 */

export const CHECK_REGION_KEY = "check_region";

/** Documented Durable Object location hints, longest names first for parsing. */
export const LOCATION_HINTS = [
  "apac-ne",
  "apac-se",
  "wnam",
  "enam",
  "sam",
  "weur",
  "eeur",
  "apac",
  "oc",
  "afr",
  "me",
] as const;

export type LocationHint = (typeof LOCATION_HINTS)[number];

export const CHECK_REGION_IDS = ["auto", ...LOCATION_HINTS] as const;
export type CheckRegionId = (typeof CHECK_REGION_IDS)[number];

export const MONITOR_REGION_CHOICES = ["inherit", ...CHECK_REGION_IDS] as const;
export type MonitorRegionChoice = (typeof MONITOR_REGION_CHOICES)[number];

const HINT_SET = new Set<string>(LOCATION_HINTS);
const REGION_SET = new Set<string>(CHECK_REGION_IDS);
const CHOICE_SET = new Set<string>(MONITOR_REGION_CHOICES);

export function isLocationHint(value: string): value is LocationHint {
  return HINT_SET.has(value);
}

export function isCheckRegion(value: string): value is CheckRegionId {
  return REGION_SET.has(value);
}

export function isMonitorRegionChoice(
  value: string,
): value is MonitorRegionChoice {
  return CHOICE_SET.has(value);
}

/** `["default"]` and `["inherit"]` both mean "use the global setting". */
export function storedRegion(regionsJson: string): MonitorRegionChoice {
  try {
    const parsed = JSON.parse(regionsJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return "inherit";
    return normalizeChoice(parsed[0]);
  } catch {
    return "inherit";
  }
}

export function normalizeChoice(value: unknown): MonitorRegionChoice {
  if (value === "default" || value === "inherit" || value == null)
    return "inherit";
  if (typeof value === "string" && isMonitorRegionChoice(value)) return value;
  return "inherit";
}

export function encodeRegionChoice(choice: MonitorRegionChoice): string {
  return JSON.stringify([choice === "inherit" ? "default" : choice]);
}

export function effectiveRegion(
  choice: MonitorRegionChoice,
  globalRegion: CheckRegionId,
): CheckRegionId {
  if (choice === "inherit") return globalRegion;
  return choice;
}

export function normalizeGlobalRegion(value: unknown): CheckRegionId {
  if (typeof value === "string" && isCheckRegion(value)) return value;
  return "auto";
}

export function regionOfShard(shardId: string): CheckRegionId | null {
  if (/^shard-\d+$/.test(shardId)) return "auto";
  for (const hint of LOCATION_HINTS) {
    if (new RegExp(`^${hint}-\\d+$`).test(shardId)) return hint;
  }
  return null;
}

export function shardIndex(shardId: string): number | null {
  const region = regionOfShard(shardId);
  if (!region) return null;
  const prefix = region === "auto" ? "shard-" : `${region}-`;
  const index = Number(shardId.slice(prefix.length));
  if (!Number.isInteger(index) || index < 0) return null;
  return index;
}

export function shardName(region: CheckRegionId, index: number): string {
  if (region === "auto") return `shard-${index}`;
  return `${region}-${index}`;
}

/** `undefined` means "do not pass locationHint" (Automatic, including shard-0). */
export function locationHintForShard(
  shardId: string,
): LocationHint | undefined {
  const region = regionOfShard(shardId);
  if (!region || region === "auto") return undefined;
  return region;
}
