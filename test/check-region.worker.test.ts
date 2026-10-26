// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { regionOfShard } from "../shared/regions";
import { api, cookieFrom, ownerSession } from "./helpers";

async function invite(
  owner: string,
  role: "admin" | "editor" | "viewer",
): Promise<string> {
  const email = `${role}-region-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const sent = await api(
    "/api/team/invites",
    { method: "POST", body: JSON.stringify({ role, email }) },
    owner,
  );
  expect(sent.status, await sent.clone().text()).toBe(201);
  const token =
    ((await sent.json()) as { link: string }).link.split("/").pop() ?? "";
  const accepted = await api("/api/invites/accept", {
    method: "POST",
    body: JSON.stringify({
      token,
      name: role,
      email,
      password: "correct-horse",
    }),
  });
  expect(accepted.status, await accepted.clone().text()).toBe(201);
  return cookieFrom(accepted);
}

const monitorBody = {
  name: "Region role",
  type: "heartbeat",
  config: { graceSeconds: 30 },
  intervalSeconds: 60,
  timeoutSeconds: 10,
  retries: 1,
  recoveryThreshold: 1,
  channelIds: [] as string[],
  paused: true,
  region: "inherit",
};

describe("check region access", () => {
  it("stores the global region for an owner and lets an editor override one monitor", async () => {
    const owner = await ownerSession();
    const viewer = await invite(owner, "viewer");
    const editor = await invite(owner, "editor");
    const admin = await invite(owner, "admin");

    const viewerSettings = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ checkRegion: "apac" }) },
      viewer,
    );
    expect(viewerSettings.status).toBe(403);
    const editorSettings = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ checkRegion: "apac" }) },
      editor,
    );
    expect(editorSettings.status).toBe(403);
    const adminSettings = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ checkRegion: "apac" }) },
      admin,
    );
    expect(adminSettings.status).toBe(403);

    const saved = await api(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ checkRegion: "auto" }) },
      owner,
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    const settings = (await (await api("/api/settings", {}, owner)).json()) as {
      checkRegion: string;
    };
    expect(settings.checkRegion).toBe("auto");
    const audit = await env.DB.prepare(
      "SELECT after_json FROM audit_log WHERE action = 'instance.settings' ORDER BY created_at DESC LIMIT 1",
    ).first<{ after_json: string }>();
    expect(audit?.after_json).toContain('"checkRegion":"auto"');
    const stored = await env.DB.prepare(
      "SELECT value_json FROM settings WHERE key = 'check_region'",
    ).first<{ value_json: string }>();
    expect(stored?.value_json).toBe('"auto"');

    const created = await api(
      "/api/monitors",
      { method: "POST", body: JSON.stringify(monitorBody) },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const detail = (await (
      await api(`/api/monitors/${id}`, {}, viewer)
    ).json()) as { region: string; effectiveRegion: string };
    expect(detail.region).toBe("inherit");
    expect(detail.effectiveRegion).toBe("auto");

    const denied = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ ...monitorBody, region: "weur" }),
      },
      viewer,
    );
    expect(denied.status).toBe(403);

    const patched = await api(
      `/api/monitors/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ ...monitorBody, region: "weur" }),
      },
      editor,
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
    const updated = (await patched.json()) as {
      region: string;
      effectiveRegion: string;
    };
    expect(updated.region).toBe("weur");
    expect(updated.effectiveRegion).toBe("weur");
    const row = await env.DB.prepare(
      "SELECT shard_id, regions_json FROM monitors WHERE id = ?",
    )
      .bind(id)
      .first<{ shard_id: string; regions_json: string }>();
    expect(row?.regions_json).toBe('["weur"]');
    expect(regionOfShard(row?.shard_id ?? "")).toBe("weur");
    const change = await env.DB.prepare(
      "SELECT after_json FROM audit_log WHERE action = 'monitor.update' AND target = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(id)
      .first<{ after_json: string }>();
    expect(change?.after_json).toContain('"region":"weur"');

    const removed = await api(
      `/api/monitors/${id}`,
      { method: "DELETE" },
      owner,
    );
    expect(removed.status).toBe(200);
  });
});
