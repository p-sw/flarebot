import { describe, expect, test } from "vitest";
import {
  canReuseSession,
  retireSessionCache,
  sessionCacheEpoch,
  sessionCacheKey,
} from "./session-gate";

const user = { id: "1" };

describe("canReuseSession", () => {
  test("reuses a cached user while staying in the app or preloading", () => {
    expect(canReuseSession("stay", user)).toBe(true);
    expect(canReuseSession("preload", user)).toBe(true);
  });

  test("blocks on enter and when no user is cached", () => {
    expect(canReuseSession("enter", user)).toBe(false);
    expect(canReuseSession("stay", null)).toBe(false);
    expect(canReuseSession("preload", undefined)).toBe(false);
  });
});

describe("session cache epoch", () => {
  test("moves the cache key forward so a retired session cannot be reused", () => {
    const first = sessionCacheKey();
    expect(first).toEqual(["session", sessionCacheEpoch()]);
    const next = retireSessionCache();
    expect(sessionCacheEpoch()).toBe(next);
    expect(sessionCacheKey()).toEqual(["session", next]);
    expect(sessionCacheKey()).not.toEqual(first);
  });
});
