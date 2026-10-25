// SPDX-License-Identifier: MIT

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { commitMonitor, loadQuery, refreshQueries } from "./query-sync";

const monitor = {
  id: "mon-1",
  name: "API",
  type: "heartbeat",
  status: "paused",
  uptime24: null,
  lastResponseMs: 12,
  lastError: null,
  paused: true,
  intervalSeconds: 60,
  target: "",
  config: {},
  timeoutSeconds: 10,
  retries: 2,
  recoveryThreshold: 1,
  channelIds: [] as string[],
  regions: ["default"],
  since: null,
  lastCheckAt: null,
  createdAt: 1,
  updatedAt: 2,
  statusPages: [],
};

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
}

describe("query cache after a confirmed mutation", () => {
  it("keeps a preloaded list when ensureQueryData is used after invalidation", async () => {
    const queryClient = client();
    let value = "up";
    const options = {
      queryKey: ["monitors"],
      staleTime: 30_000,
      queryFn: async () => value,
    };
    await queryClient.fetchQuery(options);
    value = "paused";
    await queryClient.invalidateQueries({
      queryKey: ["monitors"],
      refetchType: "none",
    });
    await expect(queryClient.ensureQueryData(options)).resolves.toBe("up");
  });

  it("loads the invalidated value instead of the preload", async () => {
    const queryClient = client();
    let value = "up";
    const options = {
      queryKey: ["monitors"],
      staleTime: 30_000,
      queryFn: async () => value,
    };
    await queryClient.fetchQuery(options);
    value = "paused";
    await queryClient.invalidateQueries({
      queryKey: ["monitors"],
      refetchType: "none",
    });
    await expect(loadQuery(queryClient, options)).resolves.toBe("paused");
  });

  it("refetches inactive queries so a later read is already current", async () => {
    const queryClient = client();
    let value = "up";
    const options = {
      queryKey: ["pages"],
      staleTime: 30_000,
      queryFn: async () => value,
    };
    await queryClient.fetchQuery(options);
    value = "published";
    await refreshQueries(queryClient, [["pages"]]);
    expect(queryClient.getQueryData(["pages"])).toBe("published");
  });

  it("writes a confirmed monitor into the detail cache and the list row", () => {
    const queryClient = client();
    queryClient.setQueryData(["monitors"], {
      monitors: [
        {
          id: "mon-1",
          name: "API",
          type: "heartbeat",
          status: "up",
          uptime24: 99,
          lastResponseMs: 12,
          lastError: null,
          paused: false,
        },
        {
          id: "mon-2",
          name: "Other",
          type: "http",
          status: "down",
          uptime24: null,
          lastResponseMs: null,
          lastError: "timeout",
          paused: false,
        },
      ],
    });
    commitMonitor(queryClient, monitor);
    expect(queryClient.getQueryData(["monitor", "mon-1"])).toMatchObject({
      paused: true,
      status: "paused",
    });
    const list = queryClient.getQueryData<{
      monitors: {
        id: string;
        status: string;
        paused: boolean;
        uptime24: number | null;
      }[];
    }>(["monitors"]);
    expect(list?.monitors[0]).toMatchObject({
      status: "paused",
      paused: true,
      uptime24: 99,
    });
    expect(list?.monitors[1]).toMatchObject({ id: "mon-2", status: "down" });
  });

  it("does not invent a monitor list that was never loaded", () => {
    const queryClient = client();
    commitMonitor(queryClient, monitor);
    expect(queryClient.getQueryData(["monitors"])).toBeUndefined();
    expect(queryClient.getQueryData(["monitor", "mon-1"])).toMatchObject({
      id: "mon-1",
      status: "paused",
    });
  });
});
