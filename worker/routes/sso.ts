// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { t } from "../../shared/copy";
import type { Role } from "../../shared/permissions";
import { isRole } from "../../shared/permissions";
import {
  accessTeamHost,
  canonicalIssuer,
  discoveryBodySchema,
  MAX_OIDC_PROVIDERS,
  normalizeDomains,
  type OidcMapping,
  policySchema,
  providerInputSchema,
  type SsoPolicy,
  scopesIncludeOpenId,
  validClaimName,
} from "../../shared/sso";
import { loginWithAccess } from "../auth/access";
import { SsoFlowError, ssoFailure } from "../auth/errors";
import {
  beginOidcLogin,
  consumeOidcTransaction,
  fetchDiscovery,
  finishOidcLogin,
} from "../auth/oidc";
import { readPolicy, writePolicy } from "../auth/policy";
import {
  encryptString,
  requireEncryptionKey,
  timingSafeEqual,
} from "../crypto/secret";
import { getDb } from "../db/client";
import { loginAttempts, ssoProviders } from "../db/schema";
import {
  ApiError,
  type AppEnv,
  actorForUser,
  assertMutationOrigin,
  audit,
  clientIp,
  createSession,
  parseBody,
  publicUser,
  requestOrigin,
  requireActor,
  requireCan,
} from "../http";

const STATE_COOKIE = "flarebot_oidc";

function redirectUri(origin: string): string {
  return `${origin}/api/auth/oidc/callback`;
}

function cookieSecure(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function writeStateCookie(
  c: Parameters<typeof setCookie>[0],
  state: string,
): void {
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/api/auth/oidc",
    secure: cookieSecure(c.req.url),
    maxAge: 600,
  });
}

function clearStateCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth/oidc" });
}

function encryptionKey(env: Env): string {
  try {
    return requireEncryptionKey(env);
  } catch {
    throw new ApiError(503, "sso_encryption", t("error_sso_encryption"));
  }
}

function stringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mappingArray(value: string): OidcMapping[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OidcMapping =>
        !!item &&
        typeof item === "object" &&
        typeof (item as OidcMapping).value === "string" &&
        isRole((item as OidcMapping).role),
    );
  } catch {
    return [];
  }
}

function publicProvider(row: typeof ssoProviders.$inferSelect) {
  return {
    id: row.id,
    enabled: row.enabled,
    displayName: row.displayName,
    buttonLabel: row.buttonLabel,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecretSet: Boolean(row.clientSecretEncrypted),
    scopes: row.scopes,
    groupsClaim: row.groupsClaim,
    jitEnabled: row.jitEnabled,
    jitRole: row.jitRole,
    allowedDomains: stringArray(row.allowedDomainsJson),
    roleMappings: mappingArray(row.roleMappingsJson),
    discoveryAt: row.discoveryAt,
  };
}

function providerAudit(row: ReturnType<typeof publicProvider>) {
  return {
    displayName: row.displayName,
    issuerUrl: row.issuerUrl,
    enabled: row.enabled,
    jitEnabled: row.jitEnabled,
    jitRole: row.jitRole,
    allowedDomains: row.allowedDomains,
    roleMappings: row.roleMappings,
    clientSecretSet: row.clientSecretSet,
  };
}

async function normalizePolicy(policy: SsoPolicy): Promise<SsoPolicy> {
  const groupsClaim = policy.access.groupsClaim.trim() || "groups";
  if (!validClaimName(groupsClaim)) {
    throw new ApiError(400, "validation", t("error_sso_claim"));
  }
  const domains = normalizeDomains(policy.access.allowedDomains);
  if (!domains) {
    throw new ApiError(400, "validation", t("error_sso_domain_format"));
  }
  let teamName = policy.access.teamName.trim();
  if (teamName) {
    const host = accessTeamHost(teamName);
    if (!host) throw new ApiError(400, "validation", t("error_access_team"));
    teamName = host;
  }
  const audiences = [
    ...new Set(
      policy.access.audiences.map((item) => item.trim()).filter(Boolean),
    ),
  ];
  if (
    policy.access.enabled &&
    (!teamName || audiences.length === 0 || policy.access.rules.length === 0)
  ) {
    throw new ApiError(400, "validation", t("error_access_rules"));
  }
  return {
    hideLocalLogin: policy.hideLocalLogin,
    access: {
      ...policy.access,
      teamName,
      audiences,
      groupsClaim,
      allowedDomains: domains,
    },
  };
}

function loginRedirect(origin: string, code: string): string {
  return `${origin}/login?sso_error=${code}`;
}

async function noteDenial(
  env: Env,
  error: SsoFlowError,
  target: string | null,
  ip: string | null,
): Promise<void> {
  if (error.code === "state" || error.code === "token") return;
  await audit(
    env,
    null,
    "auth.sso.denied",
    target,
    null,
    { reason: error.code, email: error.email },
    ip,
  );
}

export function registerSso(app: Hono<AppEnv>): void {
  app.get("/api/auth/sso", async (c) => {
    const policy = await readPolicy(c.env);
    const rows = await getDb(c.env.DB).select().from(ssoProviders);
    return c.json({
      hideLocalLogin: policy.hideLocalLogin,
      accessEnabled: policy.access.enabled,
      providers: rows
        .filter((row) => row.enabled)
        .map((row) => ({
          id: row.id,
          displayName: row.displayName,
          buttonLabel: row.buttonLabel,
        })),
    });
  });

  app.get("/api/sso", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    const policy = await readPolicy(c.env);
    const rows = await getDb(c.env.DB).select().from(ssoProviders);
    return c.json({
      redirectUri: redirectUri(requestOrigin(c)),
      hideLocalLogin: policy.hideLocalLogin,
      access: policy.access,
      providers: rows.map(publicProvider),
    });
  });

  app.put("/api/sso/policy", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    assertMutationOrigin(c, actor);
    const parsed = policySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "validation", t("error_validation"));
    }
    const before = await readPolicy(c.env);
    const next = await normalizePolicy(parsed.data);
    await writePolicy(c.env, next);
    await audit(
      c.env,
      actor,
      "sso.policy.update",
      null,
      before,
      next,
      clientIp(c),
    );
    return c.json(next);
  });

  app.post("/api/sso/discovery", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, discoveryBodySchema);
    const issuer = canonicalIssuer(body.issuerUrl);
    if (!issuer) throw new ApiError(400, "validation", t("error_sso_https"));
    try {
      const doc = await fetchDiscovery(issuer);
      return c.json(doc);
    } catch (error) {
      if (error instanceof SsoFlowError) {
        throw new ApiError(
          400,
          "sso_discovery",
          error.code === "token"
            ? t("error_sso_issuer")
            : t("error_sso_discovery"),
        );
      }
      throw error;
    }
  });

  app.post("/api/sso/providers", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, providerInputSchema);
    const db = getDb(c.env.DB);
    const existing = await db
      .select({ id: ssoProviders.id })
      .from(ssoProviders);
    if (existing.length >= MAX_OIDC_PROVIDERS) {
      throw new ApiError(400, "sso_limit", t("error_sso_limit"));
    }
    const stored = await providerValues(c.env, body, null);
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.insert(ssoProviders).values({
      id,
      ...stored,
      discoveryJson: null,
      discoveryAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const row = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, id))
      .get();
    if (!row) throw new ApiError(500, "internal", t("error_internal"));
    const pub = publicProvider(row);
    await audit(
      c.env,
      actor,
      "sso.provider.create",
      id,
      null,
      providerAudit(pub),
      clientIp(c),
    );
    return c.json(pub, 201);
  });

  app.put("/api/sso/providers/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, providerInputSchema);
    const db = getDb(c.env.DB);
    const current = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, c.req.param("id")))
      .get();
    if (!current) throw new ApiError(404, "not_found", t("error_not_found"));
    const stored = await providerValues(
      c.env,
      body,
      current.clientSecretEncrypted,
    );
    const issuerChanged = stored.issuerUrl !== current.issuerUrl;
    await db
      .update(ssoProviders)
      .set({
        ...stored,
        ...(issuerChanged ? { discoveryJson: null, discoveryAt: null } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(ssoProviders.id, current.id));
    const row = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, current.id))
      .get();
    if (!row) throw new ApiError(500, "internal", t("error_internal"));
    const pub = publicProvider(row);
    await audit(
      c.env,
      actor,
      "sso.provider.update",
      current.id,
      providerAudit(publicProvider(current)),
      providerAudit(pub),
      clientIp(c),
    );
    return c.json(pub);
  });

  app.delete("/api/sso/providers/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "sso.manage");
    assertMutationOrigin(c, actor);
    const db = getDb(c.env.DB);
    const current = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, c.req.param("id")))
      .get();
    if (!current) throw new ApiError(404, "not_found", t("error_not_found"));
    const pub = publicProvider(current);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM oidc_transactions WHERE provider_id = ?",
      ).bind(current.id),
      c.env.DB.prepare("DELETE FROM sso_identities WHERE provider_id = ?").bind(
        current.id,
      ),
      c.env.DB.prepare("DELETE FROM sso_providers WHERE id = ?").bind(
        current.id,
      ),
    ]);
    await audit(
      c.env,
      actor,
      "sso.provider.delete",
      current.id,
      providerAudit(pub),
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/auth/oidc/:id/start", async (c) => {
    const row = await getDb(c.env.DB)
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.id, c.req.param("id")))
      .get();
    if (!row?.enabled) {
      return c.redirect(loginRedirect(requestOrigin(c), "config"), 302);
    }
    try {
      const started = await beginOidcLogin(
        c.env,
        row,
        redirectUri(requestOrigin(c)),
      );
      writeStateCookie(c, started.state);
      return c.redirect(started.url, 302);
    } catch (error) {
      if (error instanceof SsoFlowError) {
        return c.redirect(loginRedirect(requestOrigin(c), error.code), 302);
      }
      throw error;
    }
  });

  app.get("/api/auth/oidc/callback", async (c) => {
    const origin = requestOrigin(c);
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const cookie = getCookie(c, STATE_COOKIE) ?? "";
    clearStateCookie(c);
    const idpError = c.req.query("error");
    if (idpError) return c.redirect(loginRedirect(origin, "denied"), 302);
    if (!state || !code || !cookie || !timingSafeEqual(cookie, state)) {
      return c.redirect(loginRedirect(origin, "state"), 302);
    }
    try {
      const transaction = await consumeOidcTransaction(c.env, state);
      if (!transaction) return c.redirect(loginRedirect(origin, "state"), 302);
      const linked = await finishOidcLogin(
        c.env,
        transaction,
        code,
        clientIp(c),
      );
      await getDb(c.env.DB)
        .delete(loginAttempts)
        .where(eq(loginAttempts.email, linked.email));
      await createSession(c, linked.userId, "oidc");
      const actor = await actorForUser(c.env, linked.userId);
      if (!actor) return c.redirect(loginRedirect(origin, "config"), 302);
      await audit(
        c.env,
        actor,
        "auth.oidc.login",
        transaction.providerId,
        null,
        { email: linked.email, created: linked.created },
        clientIp(c),
      );
      return c.redirect(`${origin}/console`, 302);
    } catch (error) {
      if (error instanceof SsoFlowError) {
        await noteDenial(c.env, error, null, clientIp(c));
        return c.redirect(loginRedirect(origin, error.code), 302);
      }
      throw error;
    }
  });

  app.post("/api/auth/access", async (c) => {
    const policy = await readPolicy(c.env);
    if (!policy.access.enabled) {
      throw new ApiError(401, "access_off", t("error_access_off"));
    }
    const requestOriginHeader = c.req.header("origin");
    if (!requestOriginHeader || requestOriginHeader !== requestOrigin(c)) {
      throw new ApiError(403, "origin", t("error_origin"));
    }
    const token = c.req.header("cf-access-jwt-assertion")?.trim() ?? "";
    if (!token)
      throw new ApiError(401, "access_header", t("error_access_header"));
    try {
      const linked = await loginWithAccess(c.env, policy, token, clientIp(c));
      await getDb(c.env.DB)
        .delete(loginAttempts)
        .where(eq(loginAttempts.email, linked.email));
      await createSession(c, linked.userId, "access");
      const actor = await actorForUser(c.env, linked.userId);
      if (!actor)
        throw new ApiError(500, "internal", t("error_session_not_stored"));
      await audit(
        c.env,
        actor,
        "auth.access.login",
        null,
        null,
        { email: linked.email, created: linked.created },
        clientIp(c),
      );
      return c.json({ user: publicUser(actor) });
    } catch (error) {
      if (error instanceof SsoFlowError) {
        await noteDenial(c.env, error, "cloudflare-access", clientIp(c));
        throw ssoFailure(error);
      }
      throw error;
    }
  });
}

async function providerValues(
  env: Env,
  body: {
    enabled: boolean;
    displayName: string;
    buttonLabel: string;
    issuerUrl: string;
    clientId: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    scopes: string;
    groupsClaim: string;
    jitEnabled: boolean;
    jitRole: Role;
    allowedDomains: string[];
    roleMappings: OidcMapping[];
  },
  currentSecret: string | null,
) {
  const issuerUrl = canonicalIssuer(body.issuerUrl);
  if (!issuerUrl) throw new ApiError(400, "validation", t("error_sso_https"));
  if (!scopesIncludeOpenId(body.scopes)) {
    throw new ApiError(400, "validation", t("error_sso_scopes"));
  }
  if (!validClaimName(body.groupsClaim)) {
    throw new ApiError(400, "validation", t("error_sso_claim"));
  }
  const allowedDomains = normalizeDomains(body.allowedDomains);
  if (!allowedDomains) {
    throw new ApiError(400, "validation", t("error_sso_domain_format"));
  }
  let clientSecretEncrypted = currentSecret;
  if (body.clearClientSecret) clientSecretEncrypted = null;
  if (body.clientSecret) {
    clientSecretEncrypted = await encryptString(
      encryptionKey(env),
      body.clientSecret,
    );
  }
  return {
    enabled: body.enabled,
    displayName: body.displayName,
    buttonLabel: body.buttonLabel,
    issuerUrl,
    clientId: body.clientId,
    clientSecretEncrypted,
    scopes: body.scopes,
    groupsClaim: body.groupsClaim,
    jitEnabled: body.jitEnabled,
    jitRole: body.jitRole,
    allowedDomainsJson: JSON.stringify(allowedDomains),
    roleMappingsJson: JSON.stringify(body.roleMappings),
  };
}
