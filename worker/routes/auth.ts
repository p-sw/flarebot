// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { t } from "../../shared/copy";
import {
  acceptInviteSchema,
  forgotSchema,
  loginSchema,
  resetSchema,
  setupSchema,
} from "../../shared/schemas";
import { assertLocalLoginAllowed } from "../auth/policy";
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../auth/webauthn";
import {
  b64ToBytes,
  decryptString,
  hashPassword,
  randomToken,
  requireEncryptionKey,
  sha256Hex,
  verifyPassword,
  verifyTotp,
} from "../crypto/secret";
import { getDb } from "../db/client";
import {
  emailTokens,
  invites,
  loginAttempts,
  memberships,
  organizations,
  sessions,
  users,
} from "../db/schema";
import {
  ApiError,
  type AppEnv,
  actorForUser,
  audit,
  clearSessionCookie,
  clientIp,
  createSession,
  loadActor,
  parseBody,
  publicUser,
  requestOrigin,
  requireActor,
  timingSafeSecret,
  verifyTurnstile,
} from "../http";
import { enqueueMail } from "../mail/mailer";
import { resetMail } from "../notify/copy";
import { instanceName } from "../settings-store";

async function noteFailure(env: Env, email: string): Promise<void> {
  const db = getDb(env.DB);
  const now = Date.now();
  const attempt = await db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.email, email))
    .get();
  const failures = (attempt?.failures ?? 0) + 1;
  const lockedUntil = failures >= 5 ? now + 15 * 60_000 : null;
  await db
    .insert(loginAttempts)
    .values({ email, failures, lockedUntil })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: { failures, lockedUntil },
    });
}

export function registerAuth(app: Hono<AppEnv>): void {
  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/meta", async (c) => {
    const db = getDb(c.env.DB);
    const owner = await db.select({ id: users.id }).from(users).limit(1).get();
    return c.json({
      name: t("app_name"),
      setupRequired: !owner,
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
    });
  });

  app.post("/api/setup", async (c) => {
    const body = await parseBody(c, setupSchema);
    if (!c.env.SETUP_SECRET)
      throw new ApiError(
        503,
        "setup_unavailable",
        t("error_setup_unavailable"),
      );
    await verifyTurnstile(c.env, body.turnstileToken, clientIp(c));
    if (!timingSafeSecret(body.setupSecret, c.env.SETUP_SECRET)) {
      throw new ApiError(401, "bad_secret", t("error_bad_secret"));
    }
    const db = getDb(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .limit(1)
      .get();
    if (existing)
      throw new ApiError(409, "setup_closed", t("error_setup_closed"));
    const now = Date.now();
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const email = body.email.toLowerCase();
    await db
      .insert(organizations)
      .values({ id: orgId, name: t("app_name"), createdAt: now });
    await db.insert(users).values({
      id: userId,
      email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      totpSecret: null,
      totpPending: null,
      totpEnabled: false,
      disabled: false,
      locale: null,
      createdAt: now,
    });
    await db.insert(memberships).values({
      id: crypto.randomUUID(),
      userId,
      organizationId: orgId,
      role: "owner",
      createdAt: now,
    });
    await createSession(c, userId, "setup");
    const actor = await actorForUser(c.env, userId);
    if (!actor)
      throw new ApiError(500, "internal", t("error_session_not_stored"));
    await audit(
      c.env,
      actor,
      "instance.setup",
      orgId,
      null,
      { email },
      clientIp(c),
    );
    return c.json({ user: publicUser(actor) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = await parseBody(c, loginSchema);
    await verifyTurnstile(c.env, body.turnstileToken, clientIp(c));
    const email = body.email.toLowerCase();
    const db = getDb(c.env.DB);
    const attempt = await db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.email, email))
      .get();
    if (attempt?.lockedUntil && attempt.lockedUntil > Date.now()) {
      throw new ApiError(429, "locked", t("error_locked"));
    }
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();
    const passwordOk = user?.passwordHash
      ? await verifyPassword(body.password, user.passwordHash)
      : false;
    if (!user || user.disabled || !passwordOk) {
      await noteFailure(c.env, email);
      throw new ApiError(401, "unauthorized", t("error_bad_credentials"));
    }
    if (user.totpEnabled) {
      if (!body.totp)
        throw new ApiError(401, "totp_required", t("error_totp_required"));
      if (!user.totpSecret)
        throw new ApiError(401, "totp_invalid", t("error_totp_invalid"));
      const secret = b64ToBytes(
        await decryptString(requireEncryptionKey(c.env), user.totpSecret),
      );
      if (!(await verifyTotp(secret, body.totp, Date.now()))) {
        await noteFailure(c.env, email);
        throw new ApiError(401, "totp_invalid", t("error_totp_invalid"));
      }
    }
    await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
    await assertLocalLoginAllowed(c.env, user.id);
    await createSession(
      c,
      user.id,
      user.totpEnabled ? "password+totp" : "password",
    );
    const actor = await actorForUser(c.env, user.id);
    if (!actor)
      throw new ApiError(500, "internal", t("error_session_not_stored"));
    return c.json({ user: publicUser(actor) });
  });

  app.post("/api/auth/logout", async (c) => {
    const actor = await loadActor(c);
    if (actor?.sessionId) {
      await getDb(c.env.DB)
        .delete(sessions)
        .where(eq(sessions.id, actor.sessionId));
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/auth/session", async (c) => {
    const actor = await loadActor(c);
    if (!actor) return c.json({ user: null });
    return c.json({ user: publicUser(actor) });
  });

  app.post("/api/auth/passkey/options", async (c) => {
    return c.json(await authenticationOptions(c));
  });

  app.post("/api/auth/passkey/verify", async (c) => {
    const body = (await c.req.json()) as {
      response?: AuthenticationResponseJSON;
    };
    if (!body.response)
      throw new ApiError(400, "validation", t("error_passkey_missing"));
    const userId = await verifyAuthentication(c, body.response);
    const user = await getDb(c.env.DB)
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!user || user.disabled)
      throw new ApiError(401, "unauthorized", t("error_account_disabled"));
    await assertLocalLoginAllowed(c.env, user.id);
    await createSession(c, user.id, "passkey");
    const actor = await actorForUser(c.env, user.id);
    if (!actor)
      throw new ApiError(500, "internal", t("error_session_not_stored"));
    return c.json({ user: publicUser(actor) });
  });

  app.post("/api/account/passkey/options", async (c) => {
    const actor = await requireActor(c);
    return c.json(
      await registrationOptions(c, {
        id: actor.userId,
        email: actor.email,
        name: actor.name,
      }),
    );
  });

  app.post("/api/account/passkey/verify", async (c) => {
    const actor = await requireActor(c);
    const body = (await c.req.json()) as {
      response?: RegistrationResponseJSON;
      deviceName?: string;
    };
    if (!body.response)
      throw new ApiError(400, "validation", t("error_passkey_missing"));
    const created = await verifyRegistration(
      c,
      actor.userId,
      body.response,
      body.deviceName,
    );
    await audit(
      c.env,
      actor,
      "account.passkey",
      created.id,
      null,
      { deviceName: body.deviceName ?? t("passkey_default_name") },
      clientIp(c),
    );
    return c.json(created, 201);
  });

  app.post("/api/auth/forgot", async (c) => {
    const body = await parseBody(c, forgotSchema);
    const email = body.email.toLowerCase();
    const db = getDb(c.env.DB);
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (user && !user.disabled) {
      const token = randomToken();
      const now = Date.now();
      await db.insert(emailTokens).values({
        id: crypto.randomUUID(),
        tokenHash: await sha256Hex(token),
        userId: user.id,
        purpose: "reset",
        expiresAt: now + 60 * 60_000,
        usedAt: null,
        attempts: 0,
      });
      const link = `${requestOrigin(c)}/reset/${token}`;
      const copy = resetMail({
        instance: await instanceName(c.env),
        link,
      });
      await enqueueMail(c.env, {
        kind: "reset",
        to: user.email,
        subject: copy.subject,
        text: copy.text,
      }).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  app.post("/api/auth/reset", async (c) => {
    const body = await parseBody(c, resetSchema);
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.tokenHash, await sha256Hex(body.token)))
      .get();
    if (
      row?.purpose !== "reset" ||
      row.usedAt ||
      row.expiresAt < Date.now() ||
      row.attempts >= 5
    ) {
      if (row)
        await db
          .update(emailTokens)
          .set({ attempts: row.attempts + 1 })
          .where(eq(emailTokens.id, row.id));
      throw new ApiError(400, "validation", t("error_reset_invalid"));
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password) })
      .where(eq(users.id, row.userId));
    await db
      .update(emailTokens)
      .set({ usedAt: Date.now() })
      .where(eq(emailTokens.id, row.id));
    await db.delete(sessions).where(eq(sessions.userId, row.userId));
    return c.json({ ok: true });
  });

  app.post("/api/invites/preview", async (c) => {
    const body = await parseBody(c, z.object({ token: z.string().min(20) }));
    const db = getDb(c.env.DB);
    const invite = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, await sha256Hex(body.token)),
          isNull(invites.usedAt),
        ),
      )
      .get();
    if (!invite || invite.expiresAt < Date.now())
      throw new ApiError(404, "not_found", t("error_invite_invalid"));
    return c.json({ role: invite.role, email: invite.email });
  });

  app.post("/api/invites/accept", async (c) => {
    const body = await parseBody(c, acceptInviteSchema);
    const db = getDb(c.env.DB);
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, await sha256Hex(body.token)))
      .get();
    if (!invite || invite.usedAt || invite.expiresAt < Date.now()) {
      throw new ApiError(404, "not_found", t("error_invite_invalid"));
    }
    if (invite.role === "owner")
      throw new ApiError(400, "validation", t("error_invite_owner"));
    const email = body.email.toLowerCase();
    if (invite.email && invite.email.toLowerCase() !== email) {
      throw new ApiError(400, "validation", t("error_invite_email"));
    }
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (existing) throw new ApiError(409, "conflict", t("error_email_taken"));
    const now = Date.now();
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      totpSecret: null,
      totpPending: null,
      totpEnabled: false,
      disabled: false,
      locale: null,
      createdAt: now,
    });
    await db.insert(memberships).values({
      id: crypto.randomUUID(),
      userId,
      organizationId: invite.organizationId,
      role: invite.role,
      createdAt: now,
    });
    await db
      .update(invites)
      .set({ usedAt: now, usedBy: userId })
      .where(eq(invites.id, invite.id));
    await createSession(c, userId, "invite");
    const actor = await actorForUser(c.env, userId);
    return c.json({ user: actor ? publicUser(actor) : null }, 201);
  });
}
