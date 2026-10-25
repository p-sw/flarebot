// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from "react";
import { createSubmitLock, runGuarded } from "./submit-guard";

export function useSubmitGuard() {
  const lock = useRef(createSubmitLock());
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T>(task: () => Promise<T>): Promise<T | undefined> => {
      return runGuarded(lock.current, async () => {
        setPending(true);
        try {
          return await task();
        } finally {
          setPending(false);
        }
      });
    },
    [],
  );
  return { pending, run };
}
