// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../worker/crypto/secret";
import { api, cookieFrom, ownerSession } from "./helpers";

async function accept(role: string, email: string, owner: string) {
  const invite = await api(
    "/api/team/invites",
    { method: "POST", body: JSON.stringify({ role, email }) },
    owner,
  );
  expect(invite.status).toBe(201);
  const token =
    ((await invite.json()) as { link: string }).link.split("/").pop() ?? "";
  const accepted = await api("/api/invites/accept", {
    method: "POST",
    body: JSON.stringify({
      token,
      name: email,
      email,
      password: "correct-horse",
    }),
  });
  expect(accepted.status).toBe(201);
  const body = (await accepted.json()) as { user: { id: string } };
  return { cookie: cookieFrom(accepted), userId: body.user.id };
}

describe("API tokens", () => {
  it("stores a hash, refuses scopes above the creator, and honors revocation and demotion", async () => {
    const owner = await ownerSession();
    const viewer = await accept("viewer", "view-token@example.com", owner);
    const tooWide = await api(
      "/api/tokens",
      {
        method: "POST",
        body: JSON.stringify({ name: "wide", scopes: ["monitors:write"] }),
      },
      viewer.cookie,
    );
    expect(tooWide.status).toBe(403);

    const editor = await accept("editor", "edit-token@example.com", owner);
    const minted = await api(
      "/api/tokens",
      {
        method: "POST",
        body: JSON.stringify({
          name: "write",
          scopes: ["read", "monitors:write"],
        }),
      },
      editor.cookie,
    );
    expect(minted.status).toBe(201);
    const created = (await minted.json()) as { id: string; token: string };
    const raw = created.token;
    const id = created.id;
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM api_tokens WHERE id = ?",
    )
      .bind(id)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toBe(await sha256Hex(raw));
    expect(stored?.token_hash).not.toContain(raw);

    const written = await api("/api/monitors", {
      method: "POST",
      headers: { authorization: `Bearer ${raw}` },
      body: JSON.stringify({
        name: "From token",
        type: "heartbeat",
        config: { graceSeconds: 30 },
        intervalSeconds: 60,
      }),
    });
    expect(written.status).toBe(201);

    const demoted = await api(
      `/api/team/${editor.userId}/role`,
      { method: "POST", body: JSON.stringify({ role: "viewer" }) },
      owner,
    );
    expect(demoted.status).toBe(200);
    const after = await api("/api/monitors", {
      method: "POST",
      headers: { authorization: `Bearer ${raw}` },
      body: JSON.stringify({
        name: "Still writing",
        type: "heartbeat",
        config: { graceSeconds: 30 },
        intervalSeconds: 60,
      }),
    });
    expect(after.status).toBe(403);
    const read = await api("/api/monitors", {
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(read.status).toBe(200);

    const revoked = await api(
      `/api/tokens/${id}`,
      { method: "DELETE" },
      editor.cookie,
    );
    expect(revoked.status).toBe(200);
    const dead = await api("/api/monitors", {
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(dead.status).toBe(401);
  });

  it("keeps a token away from the account routes of the person who made it", async () => {
    const owner = await ownerSession();
    const minted = await api(
      "/api/tokens",
      {
        method: "POST",
        body: JSON.stringify({ name: "ro", scopes: ["read"] }),
      },
      owner,
    );
    expect(minted.status).toBe(201);
    const { token } = (await minted.json()) as { token: string };
    const bearer = { authorization: `Bearer ${token}` };
    const calls: [string, string, unknown][] = [
      ["POST", "/api/account/passkey/options", undefined],
      ["POST", "/api/account/passkey/verify", { response: {} }],
      ["PATCH", "/api/account", { name: "Mallory" }],
      ["POST", "/api/account/totp/setup", undefined],
      ["POST", "/api/account/totp/confirm", { code: "000000" }],
      ["POST", "/api/account/totp/disable", { code: "000000" }],
      ["DELETE", "/api/account/passkeys/none", undefined],
    ];
    for (const [method, path, body] of calls) {
      const response = await api(path, {
        method,
        headers: bearer,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(`${path} ${response.status}`).toBe(`${path} 403`);
    }
    const account = await api("/api/account", {}, owner);
    expect(((await account.json()) as { name: string }).name).toBe("Ada");
    const pending = await env.DB.prepare(
      "SELECT totp_pending FROM users WHERE email = ?",
    )
      .bind("ada@example.com")
      .first<{ totp_pending: string | null }>();
    expect(pending?.totp_pending).toBeNull();
  });

  it("does not let an admin issue a reset link for an owner", async () => {
    const owner = await ownerSession();
    const admin = await accept("admin", "admin-reset@example.com", owner);
    const editor = await accept("editor", "edit-reset@example.com", owner);
    const session = await api("/api/auth/session", {}, owner);
    const ownerId = ((await session.json()) as { user: { id: string } }).user
      .id;
    const refused = await api(
      `/api/team/${ownerId}/reset`,
      { method: "POST" },
      admin.cookie,
    );
    expect(refused.status).toBe(403);
    const allowed = await api(
      `/api/team/${editor.userId}/reset`,
      { method: "POST" },
      admin.cookie,
    );
    expect(allowed.status).toBe(200);
    const own = await api(
      `/api/team/${ownerId}/reset`,
      { method: "POST" },
      owner,
    );
    expect(own.status).toBe(200);
  });
});
