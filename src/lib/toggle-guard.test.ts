// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { createToggleLock } from "./toggle-guard";

describe("createToggleLock", () => {
  it("ignores a second toggle until the first one finishes", () => {
    const lock = createToggleLock();
    expect(lock.begin()).toBe(true);
    expect(lock.begin()).toBe(false);
    lock.end();
    expect(lock.begin()).toBe(true);
  });

  it("releases the lock after a failed toggle", () => {
    const lock = createToggleLock();
    expect(lock.begin()).toBe(true);
    lock.end();
    expect(lock.begin()).toBe(true);
    lock.end();
  });
});
