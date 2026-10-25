// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  createSubmitLock,
  pendingButtonProps,
  runGuarded,
} from "./submit-guard";

describe("runGuarded", () => {
  it("drops a second submit while the first request is in flight", async () => {
    const lock = createSubmitLock();
    let calls = 0;
    let release: (() => void) | undefined;
    const first = runGuarded(
      lock,
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          release = () => resolve("ok");
        }),
    );
    const second = await runGuarded(lock, async () => {
      calls += 1;
      return "again";
    });
    expect(lock.pending).toBe(true);
    expect(second).toBeUndefined();
    expect(calls).toBe(1);
    release?.();
    await expect(first).resolves.toBe("ok");
    expect(lock.pending).toBe(false);
  });

  it("clears the lock after a failure so a later submit can run", async () => {
    const lock = createSubmitLock();
    await expect(
      runGuarded(lock, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(lock.pending).toBe(false);
    await expect(runGuarded(lock, async () => "next")).resolves.toBe("next");
  });
});

describe("pendingButtonProps", () => {
  it("disables the control and marks it busy while pending", () => {
    expect(pendingButtonProps(true)).toEqual({
      disabled: true,
      "aria-busy": true,
    });
    expect(pendingButtonProps(false)).toEqual({
      disabled: false,
      "aria-busy": undefined,
    });
  });
});
