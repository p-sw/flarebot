// SPDX-License-Identifier: MIT

import { isRole, type Role } from "@shared/permissions";
import { useQueryClient } from "@tanstack/react-query";
import { sessionCacheKey } from "./session-gate";

export function useRole(): Role | null {
  const client = useQueryClient();
  const role = client.getQueryData<{ user: { role: string } | null }>(
    sessionCacheKey(),
  )?.user?.role;
  return role && isRole(role) ? role : null;
}
