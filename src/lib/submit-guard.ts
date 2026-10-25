// SPDX-License-Identifier: MIT

export type SubmitLock = { pending: boolean };

export function createSubmitLock(): SubmitLock {
  return { pending: false };
}

export async function runGuarded<T>(
  lock: SubmitLock,
  task: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.pending) return undefined;
  lock.pending = true;
  try {
    return await task();
  } finally {
    lock.pending = false;
  }
}

export function pendingButtonProps(pending: boolean): {
  disabled: boolean;
  "aria-busy": true | undefined;
} {
  return {
    disabled: pending,
    "aria-busy": pending ? true : undefined,
  };
}
