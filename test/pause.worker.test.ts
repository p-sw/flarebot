// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { schedulerStub } from "../worker/monitors/sync";
import { api, ownerSession } from "./helpers";

describe("monitor pause and resume", () => {
  it("stops scheduled checks, shows paused, then resumes into pending", async () => {
    const owner = await ownerSession();
    const created = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Pause me",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
          timeoutSeconds: 10,
          retries: 2,
          recoveryThreshold: 1,
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const listed = await api("/api/monitors", {}, owner);
    expect(listed.headers.get("cache-control")).toContain("no-store");

    const pausedAt = Date.now();
    const paused = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ paused: true }),
      },
      owner,
    );
    expect(paused.status, await paused.clone().text()).toBe(200);
    expect(paused.headers.get("cache-control")).toContain("no-store");
    const pausedBody = (await paused.json()) as {
      id: string;
      paused: boolean;
      status: string;
      name: string;
    };
    expect(pausedBody).toMatchObject({
      id,
      name: "Pause me",
      paused: true,
      status: "paused",
    });

    const row = await env.DB.prepare(
      "SELECT shard_id, paused FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string; paused: number }>();
    if (!row) throw new Error("monitor missing");
    expect(row.paused).toBe(1);
    const stub = schedulerStub(env, row.shard_id);
    const parked = await stub.getOne(id);
    expect(parked?.state.status).toBe("paused");
    expect(parked?.nextCheckAt).toBeGreaterThan(pausedAt + 86_400_000);
    const atDue = await stub.runDue((parked?.nextCheckAt ?? 0) + 1_000);
    expect(atDue.ran).toBe(0);
    expect((await stub.getOne(id))?.state.status).toBe("paused");

    const detail = await api(`/api/monitors/${id}`, {}, owner);
    expect(detail.headers.get("cache-control")).toContain("no-store");
    expect(
      ((await detail.json()) as { paused: boolean; status: string }).status,
    ).toBe("paused");

    const slug = `paused-${id.slice(0, 8)}`;
    const page = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          published: true,
          title: "Pause page",
          items: [
            {
              monitorId: id,
              position: 0,
              groupName: "",
              displayName: "Pause me",
            },
          ],
        }),
      },
      owner,
    );
    expect(page.status).toBe(201);
    const pub = (await (await api(`/api/public/status/${slug}`)).json()) as {
      overall: string;
      groups: { items: { status: string }[] }[];
    };
    expect(pub.groups[0]?.items[0]?.status).toBe("paused");
    expect(pub.overall).toBe("paused");

    const resumed = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ paused: false }),
      },
      owner,
    );
    expect(resumed.status, await resumed.clone().text()).toBe(200);
    const resumedBody = (await resumed.json()) as {
      paused: boolean;
      status: string;
    };
    expect(resumedBody.paused).toBe(false);
    expect(resumedBody.status).toBe("pending");
    const scheduled = await stub.getOne(id);
    expect(scheduled?.state.status).toBe("pending");
    expect(scheduled?.nextCheckAt).toBeLessThanOrEqual(Date.now() + 1_000);
    const ran = await stub.runDue(Date.now() + 5_000);
    expect(ran.ran).toBe(1);
    const after = (await (
      await api(`/api/monitors/${id}`, {}, owner)
    ).json()) as { paused: boolean; status: string };
    expect(after.paused).toBe(false);
    expect(after.status).not.toBe("paused");
    const pubAfter = (await (
      await api(`/api/public/status/${slug}`)
    ).json()) as {
      overall: string;
      groups: { items: { status: string }[] }[];
    };
    expect(pubAfter.groups[0]?.items[0]?.status).not.toBe("paused");
    expect(pubAfter.overall).not.toBe("paused");
  });
});
