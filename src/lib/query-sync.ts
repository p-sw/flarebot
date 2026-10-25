// SPDX-License-Identifier: MIT

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { MonitorDetail, MonitorListItem } from "./queries";

type MonitorList = { monitors: MonitorListItem[] };

// This Query version's ensureQueryData returns cached data even after
// invalidateQueries marks it stale. Loaders have to fetch so navigation
// sees a pause or resume that happened on another screen.
export function loadQuery<T>(
  client: QueryClient,
  options: Parameters<QueryClient["fetchQuery"]>[0],
): Promise<T> {
  return client.fetchQuery(options) as Promise<T>;
}

export async function refreshQueries(
  client: QueryClient,
  queryKeys: readonly QueryKey[],
): Promise<void> {
  await Promise.all(
    queryKeys.map((queryKey) =>
      client.invalidateQueries({ queryKey, refetchType: "all" }),
    ),
  );
}

export function commitMonitor(
  client: QueryClient,
  monitor: MonitorDetail,
): void {
  client.setQueryData<MonitorDetail>(["monitor", monitor.id], (current) =>
    current ? { ...current, ...monitor } : monitor,
  );
  client.setQueryData<MonitorList>(["monitors"], (current) => {
    if (!current) return current;
    return {
      ...current,
      monitors: current.monitors.map((item) =>
        item.id === monitor.id
          ? {
              ...item,
              name: monitor.name,
              type: monitor.type,
              status: monitor.status,
              paused: monitor.paused,
              lastResponseMs: monitor.lastResponseMs,
              lastError: monitor.lastError,
            }
          : item,
      ),
    };
  });
}

export function dropMonitor(client: QueryClient, id: string): void {
  client.setQueryData<MonitorList>(["monitors"], (current) =>
    current
      ? {
          ...current,
          monitors: current.monitors.filter((item) => item.id !== id),
        }
      : current,
  );
  client.removeQueries({ queryKey: ["monitor", id] });
}
