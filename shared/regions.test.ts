// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  CHECK_REGION_IDS,
  effectiveRegion,
  encodeRegionChoice,
  LOCATION_HINTS,
  locationHintForShard,
  normalizeGlobalRegion,
  regionOfShard,
  shardIndex,
  shardName,
  storedRegion,
} from "./regions";

describe("check region resolution", () => {
  it("treats a missing global value and the historical default as inherit from auto", () => {
    expect(normalizeGlobalRegion(undefined)).toBe("auto");
    expect(normalizeGlobalRegion("nope")).toBe("auto");
    expect(storedRegion('["default"]')).toBe("inherit");
    expect(storedRegion('["inherit"]')).toBe("inherit");
    expect(storedRegion("")).toBe("inherit");
    expect(storedRegion("[]")).toBe("inherit");
    expect(effectiveRegion("inherit", "auto")).toBe("auto");
    expect(effectiveRegion("inherit", "apac")).toBe("apac");
  });

  it("lets a monitor override ignore the global setting, including explicit automatic", () => {
    expect(effectiveRegion("wnam", "apac")).toBe("wnam");
    expect(effectiveRegion("auto", "apac")).toBe("auto");
    expect(effectiveRegion("apac-ne", "auto")).toBe("apac-ne");
    expect(storedRegion('["weur"]')).toBe("weur");
    expect(storedRegion('["apac-se"]')).toBe("apac-se");
    expect(encodeRegionChoice("inherit")).toBe('["default"]');
    expect(encodeRegionChoice("apac")).toBe('["apac"]');
  });

  it("names shards per region and maps the existing shard-0 to automatic", () => {
    expect(regionOfShard("shard-0")).toBe("auto");
    expect(regionOfShard("shard-3")).toBe("auto");
    expect(shardName("auto", 0)).toBe("shard-0");
    expect(shardName("auto", 2)).toBe("shard-2");
    expect(shardName("apac", 0)).toBe("apac-0");
    expect(shardName("apac-ne", 1)).toBe("apac-ne-1");
    expect(regionOfShard("apac-ne-1")).toBe("apac-ne");
    expect(regionOfShard("apac-1")).toBe("apac");
    expect(regionOfShard("apac-se-0")).toBe("apac-se");
    expect(shardIndex("apac-ne-12")).toBe(12);
    expect(shardIndex("shard-0")).toBe(0);
    expect(regionOfShard("custom-shard")).toBeNull();
  });

  it("passes a location hint only for a pinned region", () => {
    expect(locationHintForShard("shard-0")).toBeUndefined();
    expect(locationHintForShard("shard-4")).toBeUndefined();
    expect(locationHintForShard("apac-0")).toBe("apac");
    expect(locationHintForShard("apac-ne-2")).toBe("apac-ne");
    expect(locationHintForShard("me-0")).toBe("me");
    expect(LOCATION_HINTS).toContain("apac-ne");
    expect(LOCATION_HINTS).toContain("apac-se");
    expect(CHECK_REGION_IDS).toContain("auto");
    for (const hint of LOCATION_HINTS) {
      expect(locationHintForShard(shardName(hint, 0))).toBe(hint);
    }
  });
});
