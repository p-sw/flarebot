// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { monitorTargetLabel } from "../shared/monitor-draft";
import { api, ownerSession } from "./helpers";

describe("monitor list target", () => {
  it("matches the detail target label", async () => {
    const owner = await ownerSession();
    const config = { url: "https://status.example/health" };
    const created = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Picker HTTP",
          type: "http",
          config,
          intervalSeconds: 60,
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const listed = await api("/api/monitors", {}, owner);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      monitors: { id: string; type: string; target: string }[];
    };
    const row = body.monitors.find((item) => item.id === id);
    const detail = await api(`/api/monitors/${id}`, {}, owner);
    expect(detail.status).toBe(200);
    const saved = (await detail.json()) as { target: string };
    expect(row?.type).toBe("http");
    expect(row?.target).toBe(monitorTargetLabel("http", config));
    expect(saved.target).toBe(row?.target);
  });
});
