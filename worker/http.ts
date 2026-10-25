// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import type { Action, Role, Scope } from "../shared/permissions";
import { can, isRole, isScope, scopesForRole } from "../shared/permissions";
import { sha256Hex, timingSafeEqual } from "./crypto/secret";
import { getDb } from "./db/client";
import { apiTokens, auditLog, memberships, sessions, users } from "./db/schema";

export const SESSION_COOKIE = "flarebot_session";
const SESSION_DAYS = 14;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Actor = {
  userId: string;
  email: string;
  name: string;
  locale: string | null;
  organizationId: string;
  role: Role;
  tokenScopes: Scope[] | null;
  tokenId: string | null;
  sessionId: string | null;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { actor: Actor };
};

export type AppContext = Context<AppEnv>;

export function fail(error: ApiError) {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}

export function clientIp(c: AppContext): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}

export function requestOrigin(c: AppContext): string {
  return new URL(c.req.url).origin;
}

export function assertMutationOrigin(c: AppContext, actor: Actor): void {
  if (actor.tokenId) return;
  const origin = c.req.header("origin");
  if (!origin || origin !== requestOrigin(c)) {
    throw new ApiError(403, "origin", "Cross-origin request rejected");
  }
}

function cookieSecure(c: AppContext): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function writeSessionCookie(c: AppContext, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: cookieSecure(c),
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function createSession(
  c: AppContext,
  userId: string,
  method: string,
): Promise<void> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const db = getDb(c.env.DB);
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    tokenHash,
    userId,
    expiresAt: now + SESSION_DAYS * 86_400_000,
    method,
    createdAt: now,
  });
  writeSessionCookie(c, token);
}

async function actorFromUser(
  userId: string,
  env: Env,
  tokenScopes: Scope[] | null,
  tokenId: string | null,
  sessionId: string | null,
): Promise<Actor | null> {
  const db = getDb(env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.disabled) return null;
  const membership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .get();
  if (!membership || !isRole(membership.role)) return null;
  let scopes = tokenScopes;
  if (scopes) {
    const allowed = new Set(scopesForRole(membership.role));
    scopes = scopes.filter((scope) => allowed.has(scope));
  }
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: user.locale,
    organizationId: membership.organizationId,
    role: membership.role,
    tokenScopes: scopes,
    tokenId,
    sessionId,
  };
}

export async function actorForUser(
  env: Env,
  userId: string,
): Promise<Actor | null> {
  return actorFromUser(userId, env, null, null, null);
}

export async function loadActor(c: AppContext): Promise<Actor | null> {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const raw = header.slice(7).trim();
    if (!raw.startsWith("flb_")) return null;
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, await sha256Hex(raw)))
      .get();
    if (!row || row.revokedAt) return null;
    const parsed = JSON.parse(row.scopesJson) as unknown;
    const scopes = Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Scope => typeof item === "string" && isScope(item),
        )
      : [];
    await db
      .update(apiTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiTokens.id, row.id));
    return actorFromUser(row.createdBy, c.env, scopes, row.id, null);
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return null;
  const db = getDb(c.env.DB);
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, await sha256Hex(cookie)))
    .get();
  if (!session || session.expiresAt < Date.now()) return null;
  return actorFromUser(session.userId, c.env, null, null, session.id);
}

export async function requireActor(c: AppContext): Promise<Actor> {
  const existing = c.get("actor");
  if (existing) return existing;
  const actor = await loadActor(c);
  if (!actor) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  c.set("actor", actor);
  return actor;
}

export function requireCan(actor: Actor, action: Action): void {
  if (!can(actor, action))
    throw new ApiError(
      403,
      "forbidden",
      "You do not have permission to do that.",
    );
}

export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip: string | null,
): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (!token) throw new ApiError(400, "turnstile", "Complete the bot check.");
  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  const data = (await response.json()) as { success?: boolean };
  if (!data.success) throw new ApiError(400, "turnstile", "Bot check failed.");
}

export async function audit(
  env: Env,
  actor: Actor | null,
  action: string,
  target: string | null,
  before: unknown,
  after: unknown,
  ip: string | null,
): Promise<void> {
  const db = getDb(env.DB);
  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    actorUserId: actor?.userId ?? null,
    actorTokenId: actor?.tokenId ?? null,
    action,
    target,
    beforeJson: before === undefined ? null : JSON.stringify(before),
    afterJson: after === undefined ? null : JSON.stringify(after),
    ip,
    createdAt: Date.now(),
  });
}

export function timingSafeSecret(
  input: string,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}

export async function parseBody<T extends z.ZodType>(
  c: AppContext,
  schema: T,
): Promise<z.output<T>> {
  const body = await c.req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      400,
      "validation",
      result.error.issues[0]?.message ?? "Invalid request",
    );
  }
  return result.data;
}

export function publicUser(actor: Actor) {
  return {
    id: actor.userId,
    email: actor.email,
    name: actor.name,
    locale: actor.locale,
    role: actor.role,
    organizationId: actor.organizationId,
  };
}
