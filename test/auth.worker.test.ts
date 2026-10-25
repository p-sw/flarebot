// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex, totpCode } from "../worker/crypto/secret";
import { api, cookieFrom, ownerSession } from "./helpers";

function b64url(value: string): string {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

describe("auth", () => {
  it("creates the owner once and stores a password hash", async () => {
    const setup = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "test-setup-secret",
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect([201, 409]).toContain(setup.status);
    const again = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "test-setup-secret",
        name: "Bea",
        email: "bea@example.com",
        password: "correct-horse",
      }),
    });
    expect(again.status).toBe(409);
    const row = await env.DB.prepare(
      "SELECT password_hash FROM users WHERE email = ?",
    )
      .bind("ada@example.com")
      .first<{ password_hash: string }>();
    expect(row?.password_hash.startsWith("pbkdf2-sha256$")).toBe(true);
    expect(row?.password_hash).not.toContain("correct-horse");
    const cookies = setup.headers.getSetCookie();
    expect(cookies.some((item) => item.startsWith("locale=en"))).toBe(true);
  });

  it("locks a password after five failures and expires a session", async () => {
    const owner = await ownerSession();
    const invite = await api(
      "/api/team/invites",
      {
        method: "POST",
        body: JSON.stringify({ role: "editor", email: "lock@example.com" }),
      },
      owner,
    );
    expect(invite.status).toBe(201);
    const token =
      ((await invite.json()) as { link: string }).link.split("/").pop() ?? "";
    const accepted = await api("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name: "Lock",
        email: "lock@example.com",
        password: "correct-horse",
      }),
    });
    expect(accepted.status).toBe(201);
    const session = cookieFrom(accepted);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "lock@example.com",
          password: "wrong-password",
        }),
      });
      expect(failed.status).toBe(401);
    }
    const locked = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "lock@example.com",
        password: "correct-horse",
      }),
    });
    expect(locked.status).toBe(429);

    const logout = await api("/api/auth/logout", { method: "POST" }, session);
    expect(logout.status).toBe(200);
    const gone = await api("/api/auth/session", {}, session);
    expect(((await gone.json()) as { user: unknown }).user).toBeNull();

    const fresh = await ownerSession();
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
    )
      .bind(Date.now() - 1_000, await sha256Hex(fresh))
      .run();
    const expired = await api("/api/monitors", {}, fresh);
    expect(expired.status).toBe(401);
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM sessions WHERE token_hash = ?",
    )
      .bind(await sha256Hex(fresh))
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(fresh);
  });

  it("requires TOTP after it is confirmed", async () => {
    const owner = await ownerSession();
    const invite = await api(
      "/api/team/invites",
      {
        method: "POST",
        body: JSON.stringify({ role: "admin", email: "totp@example.com" }),
      },
      owner,
    );
    const token =
      ((await invite.json()) as { link: string }).link.split("/").pop() ?? "";
    const accepted = await api("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name: "Totp",
        email: "totp@example.com",
        password: "correct-horse",
      }),
    });
    const session = cookieFrom(accepted);
    const setup = await api(
      "/api/account/totp/setup",
      { method: "POST", body: JSON.stringify({}) },
      session,
    );
    expect(setup.status).toBe(200);
    const pending = await env.DB.prepare(
      "SELECT totp_pending FROM users WHERE email = ?",
    )
      .bind("totp@example.com")
      .first<{ totp_pending: string }>();
    const { b64ToBytes, decryptString } = await import(
      "../worker/crypto/secret"
    );
    const key = env.ENCRYPTION_KEY;
    if (!key) throw new Error("ENCRYPTION_KEY is not set");
    const secret = b64ToBytes(
      await decryptString(key, pending?.totp_pending ?? ""),
    );
    const code = await totpCode(secret, Date.now());
    const confirmed = await api(
      "/api/account/totp/confirm",
      { method: "POST", body: JSON.stringify({ code }) },
      session,
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    const missing = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "totp@example.com",
        password: "correct-horse",
      }),
    });
    expect(missing.status).toBe(401);
    expect(
      ((await missing.json()) as { error: { code: string } }).error.code,
    ).toBe("totp_required");
    const signedIn = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "totp@example.com",
        password: "correct-horse",
        totp: code,
      }),
    });
    expect(signedIn.status).toBe(200);
  });

  it("expires invites and consumes passkey challenges", async () => {
    const owner = await ownerSession();
    const invite = await api(
      "/api/team/invites",
      {
        method: "POST",
        body: JSON.stringify({ role: "viewer", email: "late@example.com" }),
      },
      owner,
    );
    const token =
      ((await invite.json()) as { link: string }).link.split("/").pop() ?? "";
    await env.DB.prepare(
      "UPDATE invites SET expires_at = ? WHERE token_hash = ?",
    )
      .bind(Date.now() - 1_000, await sha256Hex(token))
      .run();
    const accepted = await api("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name: "Late",
        email: "late@example.com",
        password: "correct-horse",
      }),
    });
    expect(accepted.status).toBe(404);

    const options = await api("/api/auth/passkey/options", { method: "POST" });
    expect(options.status).toBe(200);
    const challenge = ((await options.json()) as { challenge: string })
      .challenge;
    const response = {
      id: "unknown-credential",
      rawId: "unknown-credential",
      type: "public-key",
      response: {
        clientDataJSON: b64url(
          JSON.stringify({
            type: "webauthn.get",
            challenge,
            origin: "https://flarebot.test",
          }),
        ),
        authenticatorData: b64url("not-a-real-authenticator"),
        signature: b64url("sig"),
      },
      clientExtensionResults: {},
    };
    const rejected = await api("/api/auth/passkey/verify", {
      method: "POST",
      body: JSON.stringify({ response }),
    });
    expect(rejected.status).toBe(401);
    const replay = await api("/api/auth/passkey/verify", {
      method: "POST",
      body: JSON.stringify({ response }),
    });
    expect(replay.status).toBe(400);

    const registration = await api(
      "/api/account/passkey/options",
      { method: "POST" },
      owner,
    );
    expect(registration.status).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT count(*) AS n FROM webauthn_challenges WHERE type = 'registration'",
    ).first<{ n: number }>();
    expect(stored?.n).toBeGreaterThan(0);
  });
});
