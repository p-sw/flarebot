// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from "react";

export function createToggleLock() {
  let held = false;
  return {
    begin(): boolean {
      if (held) return false;
      held = true;
      return true;
    },
    end(): void {
      held = false;
    },
  };
}

export function useToggleLock() {
  const lock = useRef(createToggleLock());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const run = useCallback(async (key: string, task: () => Promise<void>) => {
    if (!lock.current.begin()) return;
    setPendingKey(key);
    try {
      await task();
    } finally {
      lock.current.end();
      setPendingKey(null);
    }
  }, []);
  return { pendingKey, pending: pendingKey !== null, run };
}
