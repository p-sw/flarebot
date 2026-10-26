// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearJwksCache } from "../worker/auth/jwt";
import {
  bytesToB64Url,
  decryptString,
  hashPassword,
} from "../worker/crypto/secret";
import { api, cookieFrom, ownerSession } from "./helpers";

const text = new TextEncoder();
const issuer = "https://idp.example.test";
let privateKey: CryptoKey;
let jwksBody = "";
let restoreFetch: (() => void) | null = null;

function b64urlJson(value: unknown): string {
  return bytesToB64Url(text.encode(JSON.stringify(value)));
}

async function signJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test", typ: "JWT" },
): Promise<string> {
  const encodedHeader = b64urlJson(header);
  const encodedPayload = b64urlJson(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      text.encode(`${encodedHeader}.${encodedPayload}`),
    ),
  );
  return `${encodedHeader}.${encodedPayload}.${bytesToB64Url(signature)}`;
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieValue(response: Response, name: string): string {
  for (const item of setCookies(response)) {
    const pair = item.split(";")[0] ?? "";
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
  }
  return "";
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.startsWith(issuer) || url.includes("cloudflareaccess.com")) {
      return handler(url, init);
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = real;
  };
}

async function resetSso(): Promise<void> {
  clearJwksCache();
  await env.DB.prepare(
    "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email != ?)",
  )
    .bind("ada@example.com")
    .run();
  await env.DB.prepare(
    "DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email != ?)",
  )
    .bind("ada@example.com")
    .run();
  await env.DB.prepare("DELETE FROM users WHERE email != ?")
    .bind("ada@example.com")
    .run();
  await env.DB.prepare("DELETE FROM oidc_transactions").run();
  await env.DB.prepare("DELETE FROM sso_identities").run();
  await env.DB.prepare("DELETE FROM sso_providers").run();
  await env.DB.prepare("DELETE FROM sso_jwks_cache").run();
  await env.DB.prepare("DELETE FROM settings WHERE key = ?")
    .bind("sso_policy")
    .run();
}

async function providerBody(extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    displayName: "Authentik",
    buttonLabel: "Sign in with Authentik",
    issuerUrl: issuer,
    clientId: "client-1",
    clientSecret: "super-secret",
    scopes: "openid email profile",
    groupsClaim: "groups",
    jitEnabled: false,
    jitRole: "viewer",
    allowedDomains: [],
    roleMappings: [],
    ...extra,
  };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  jwksBody = JSON.stringify({
    keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
  });
});

beforeEach(async () => {
  await ownerSession();
  await resetSso();
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("single sign-on", () => {
  it("keeps password login working and masks the client secret", async () => {
    const owner = await ownerSession();
    const password = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect(password.status).toBe(200);

    const created = await api(
      "/api/sso/providers",
      { method: "POST", body: JSON.stringify(await providerBody()) },
      owner,
    );
    expect(created.status).toBe(201);
    const body = await created.text();
    expect(body).not.toContain("super-secret");
    const row = await env.DB.prepare(
      "SELECT client_secret_encrypted FROM sso_providers",
    ).first<{ client_secret_encrypted: string }>();
    expect(
      await decryptString(
        env.ENCRYPTION_KEY ?? "",
        row?.client_secret_encrypted ?? "",
      ),
    ).toBe("super-secret");

    const editor = await insertUser("ed@example.com", "editor");
    const editorCookie = await login("ed@example.com");
    const denied = await api(
      "/api/sso/providers",
      { method: "POST", body: JSON.stringify(await providerBody()) },
      editorCookie,
    );
    expect(denied.status).toBe(403);
    expect(editor).toBeTruthy();
  });

  it("signs in through a mocked OpenID Connect provider and links the owner", async () => {
    const owner = await ownerSession();
    const created = await api(
      "/api/sso/providers",
      { method: "POST", body: JSON.stringify(await providerBody()) },
      owner,
    );
    const provider = (await created.json()) as { id: string };
    let tokenBody = "";
    installFetch(async (url, init) => {
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (url.endsWith("/jwks")) return new Response(jwksBody);
      tokenBody = String(init?.body ?? "");
      return Response.json({ id_token: "pending", token_type: "Bearer" });
    });

    const discovered = await api(
      "/api/sso/discovery",
      { method: "POST", body: JSON.stringify({ issuerUrl: issuer }) },
      owner,
    );
    expect(discovered.status).toBe(200);

    const start = await api(`/api/auth/oidc/${provider.id}/start`);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location") ?? "");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const state = location.searchParams.get("state") ?? "";
    const nonce = location.searchParams.get("nonce") ?? "";
    const stateCookie = setCookies(start).find((item) =>
      item.startsWith("flarebot_oidc="),
    );
    const idToken = await signJwt({
      iss: issuer,
      aud: "client-1",
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      nonce,
      sub: "ada-subject",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada",
    });
    restoreFetch?.();
    installFetch(async (url, init) => {
      if (url.endsWith("/jwks")) return new Response(jwksBody);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      tokenBody = String(init?.body ?? "");
      return Response.json({ id_token: idToken, token_type: "Bearer" });
    });

    const done = await api(
      `/api/auth/oidc/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: stateCookie?.split(";")[0] ?? "" } },
    );
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("https://flarebot.test/console");
    expect(tokenBody).toContain("code_verifier=");
    expect(tokenBody).toContain("client_secret=super-secret");
    const session = cookieValue(done, "flarebot_session");
    const who = await api("/api/auth/session", {}, session);
    expect(await who.json()).toMatchObject({
      user: { email: "ada@example.com", role: "owner" },
    });
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action = ?",
    )
      .bind("auth.oidc.login")
      .all();
    expect(audit.results.length).toBeGreaterThan(0);

    const listed = (await (await api("/api/auth/sso")).json()) as {
      providers: { buttonLabel: string }[];
    };
    expect(listed.providers.map((item) => item.buttonLabel)).toContain(
      "Sign in with Authentik",
    );
  });

  it("provisions a viewer, rejects another domain, and maps a group", async () => {
    const owner = await ownerSession();
    const created = await api(
      "/api/sso/providers",
      {
        method: "POST",
        body: JSON.stringify(
          await providerBody({
            jitEnabled: true,
            allowedDomains: ["example.com"],
            roleMappings: [{ value: "admins", role: "admin" }],
          }),
        ),
      },
      owner,
    );
    const provider = (await created.json()) as { id: string };
    const outsider = await finishLogin(provider.id, {
      email: "ada@other.test",
      sub: "outsider",
    });
    expect(outsider.headers.get("location")).toContain("sso_error=domain");

    const createdUser = await finishLogin(provider.id, {
      email: "new@example.com",
      sub: "new-user",
      groups: ["readers"],
    });
    expect(createdUser.headers.get("location")).toBe(
      "https://flarebot.test/console",
    );
    const viewer = await env.DB.prepare(
      "SELECT role FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    )
      .bind("new@example.com")
      .first<{ role: string }>();
    expect(viewer?.role).toBe("viewer");

    const admin = await finishLogin(provider.id, {
      email: "mapped@example.com",
      sub: "mapped",
      groups: ["admins"],
    });
    const role = await env.DB.prepare(
      "SELECT role FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = ?)",
    )
      .bind("mapped@example.com")
      .first<{ role: string }>();
    expect(admin.status).toBe(302);
    expect(role?.role).toBe("admin");
  });

  it("hides local sign-in from everyone except an owner", async () => {
    const owner = await ownerSession();
    await insertUser("guest@example.com", "editor");
    const saved = await api(
      "/api/sso/policy",
      {
        method: "PUT",
        body: JSON.stringify({
          hideLocalLogin: true,
          access: {
            enabled: false,
            teamName: "",
            audiences: [],
            groupsClaim: "groups",
            jitEnabled: false,
            allowedDomains: [],
            rules: [],
          },
        }),
      },
      owner,
    );
    expect(saved.status).toBe(200);
    const guest = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "guest@example.com",
        password: "correct-horse",
      }),
    });
    expect(guest.status).toBe(403);
    const stillOwner = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    expect(stillOwner.status).toBe(200);
  });

  it("trusts a Cloudflare Access token only after it is enabled and valid", async () => {
    const owner = await ownerSession();
    const token = await signJwt({
      iss: "https://team.cloudflareaccess.com",
      aud: ["aud-tag"],
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      type: "app",
      sub: "access-ada",
      email: "ada@example.com",
      name: "Ada",
    });
    let fetched = false;
    installFetch(() => {
      fetched = true;
      return new Response(jwksBody);
    });
    const ignored = await api("/api/auth/access", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(ignored.status).toBe(401);
    expect(fetched).toBe(false);
    expect(ignored.headers.get("set-cookie") ?? "").not.toContain(
      "flarebot_session=",
    );

    const enabled = await api(
      "/api/sso/policy",
      {
        method: "PUT",
        body: JSON.stringify({
          hideLocalLogin: false,
          access: {
            enabled: true,
            teamName: "team",
            audiences: ["aud-tag"],
            groupsClaim: "groups",
            jitEnabled: true,
            allowedDomains: [],
            rules: [{ kind: "email", value: "ada@example.com", role: "owner" }],
          },
        }),
      },
      owner,
    );
    expect(enabled.status).toBe(200);

    const bad = await api("/api/auth/access", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": `${token}x` },
    });
    expect(bad.status).toBe(401);

    const wrongAudience = await signJwt({
      iss: "https://team.cloudflareaccess.com",
      aud: ["other"],
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      type: "app",
      email: "ada@example.com",
      sub: "access-ada",
    });
    expect(
      (
        await api("/api/auth/access", {
          method: "POST",
          headers: { "cf-access-jwt-assertion": wrongAudience },
        })
      ).status,
    ).toBe(401);

    const accepted = await api("/api/auth/access", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(accepted.status).toBe(200);
    const session = cookieFrom(accepted);
    const who = await api("/api/auth/session", {}, session);
    expect(await who.json()).toMatchObject({
      user: { email: "ada@example.com" },
    });

    const stranger = await signJwt({
      iss: "https://team.cloudflareaccess.com",
      aud: ["aud-tag"],
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      type: "app",
      email: "stranger@example.com",
      sub: "stranger",
    });
    const denied = await api("/api/auth/access", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": stranger },
    });
    expect(denied.status).toBe(403);

    const page = await api("/api/public/root", {
      headers: { "cf-access-jwt-assertion": token },
    });
    expect(page.status).toBe(404);
  });
});

async function insertUser(email: string, role: string): Promise<string> {
  const org = await env.DB.prepare(
    "SELECT organization_id FROM memberships LIMIT 1",
  ).first<{ organization_id: string }>();
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, totp_enabled, disabled, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
  )
    .bind(id, email, email, await hashPassword("correct-horse"), now)
    .run();
  await env.DB.prepare(
    "INSERT INTO memberships (id, user_id, organization_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), id, org?.organization_id ?? "", role, now)
    .run();
  return id;
}

async function login(email: string): Promise<string> {
  const response = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "correct-horse" }),
  });
  return cookieFrom(response);
}

async function finishLogin(
  providerId: string,
  claims: { email: string; sub: string; groups?: string[] },
): Promise<Response> {
  const discovery = Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  });
  restoreFetch?.();
  installFetch(async (url) => {
    if (url.endsWith("/jwks")) return new Response(jwksBody);
    if (url.endsWith("/.well-known/openid-configuration"))
      return discovery.clone();
    return Response.json({ id_token: "placeholder", token_type: "Bearer" });
  });
  const start = await api(`/api/auth/oidc/${providerId}/start`);
  const location = new URL(start.headers.get("location") ?? issuer);
  const state = location.searchParams.get("state") ?? "";
  const nonce = location.searchParams.get("nonce") ?? "";
  const stateCookie = setCookies(start).find((item) =>
    item.startsWith("flarebot_oidc="),
  );
  const idToken = await signJwt({
    iss: issuer,
    aud: "client-1",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce,
    sub: claims.sub,
    email: claims.email,
    email_verified: true,
    groups: claims.groups ?? [],
  });
  restoreFetch?.();
  installFetch(async (url) => {
    if (url.endsWith("/jwks")) return new Response(jwksBody);
    if (url.endsWith("/.well-known/openid-configuration"))
      return discovery.clone();
    return Response.json({ id_token: idToken, token_type: "Bearer" });
  });
  return api(
    `/api/auth/oidc/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: stateCookie?.split(";")[0] ?? "" } },
  );
}
