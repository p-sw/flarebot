// SPDX-License-Identifier: MIT

import type { QueryClient } from "@tanstack/react-query";
import { retireSessionCache } from "./session-gate";

/** Forget the signed-in user before a late session response can write it back. */
export function dropCachedSession(client: QueryClient) {
  retireSessionCache();
  void client.cancelQueries({ queryKey: ["session"] });
  client.clear();
}
