// SPDX-License-Identifier: MIT

import { and, eq } from "drizzle-orm";
import type { Role } from "../../shared/permissions";
import { isRole } from "../../shared/permissions";
import { emailDomainAllowed, type RoleRule } from "../../shared/sso";
import { getDb } from "../db/client";
import { memberships, organizations, ssoIdentities, users } from "../db/schema";
import { audit } from "../http";
import { SsoFlowError } from "./errors";

export type LinkInput = {
  providerId: string;
  subject: string;
  email: string;
  name: string;
  mappedRole: Role | null;
  jitEnabled: boolean;
  jitRole: Role;
  allowedDomains: readonly string[];
  ip: string | null;
};

export type LinkedAccount = {
  userId: string;
  created: boolean;
  email: string;
};

async function ownerCount(env: Env, organizationId: string): Promise<number> {
  const rows = await getDb(env.DB)
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "owner"),
      ),
    );
  return rows.length;
}

async function syncRole(
  env: Env,
  userId: string,
  organizationId: string,
  next: Role,
  ip: string | null,
): Promise<void> {
  const db = getDb(env.DB);
  const membership = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .get();
  if (!membership || !isRole(membership.role)) throw new SsoFlowError("config");
  if (membership.role === next) return;
  if (membership.role === "owner" && next !== "owner") {
    if ((await ownerCount(env, organizationId)) <= 1) {
      await audit(
        env,
        {
          userId,
          email: "",
          name: "",
          organizationId,
          role: "owner",
          tokenScopes: null,
          tokenId: null,
          sessionId: null,
        },
        "sso.role.kept",
        userId,
        { role: membership.role },
        { role: next },
        ip,
      );
      return;
    }
  }
  await db
    .update(memberships)
    .set({ role: next })
    .where(eq(memberships.id, membership.id));
  await audit(
    env,
    {
      userId,
      email: "",
      name: "",
      organizationId,
      role: next,
      tokenScopes: null,
      tokenId: null,
      sessionId: null,
    },
    "sso.role.sync",
    userId,
    { role: membership.role },
    { role: next },
    ip,
  );
}

async function rememberIdentity(
  env: Env,
  providerId: string,
  subject: string,
  userId: string,
  email: string,
): Promise<void> {
  const db = getDb(env.DB);
  const existing = await db
    .select()
    .from(ssoIdentities)
    .where(
      and(
        eq(ssoIdentities.providerId, providerId),
        eq(ssoIdentities.subject, subject),
      ),
    )
    .get();
  if (existing) {
    if (existing.userId !== userId) throw new SsoFlowError("link", email);
    if (existing.email !== email) {
      await db
        .update(ssoIdentities)
        .set({ email })
        .where(eq(ssoIdentities.id, existing.id));
    }
    return;
  }
  await db.insert(ssoIdentities).values({
    id: crypto.randomUUID(),
    providerId,
    subject,
    userId,
    email,
    createdAt: Date.now(),
  });
}

export async function linkSsoAccount(
  env: Env,
  input: LinkInput,
): Promise<LinkedAccount> {
  const email = input.email.trim().toLowerCase();
  if (!emailDomainAllowed(email, input.allowedDomains)) {
    throw new SsoFlowError("domain", email);
  }
  const db = getDb(env.DB);
  const org = await db.select().from(organizations).limit(1).get();
  if (!org) throw new SsoFlowError("config");

  const identity = await db
    .select()
    .from(ssoIdentities)
    .where(
      and(
        eq(ssoIdentities.providerId, input.providerId),
        eq(ssoIdentities.subject, input.subject),
      ),
    )
    .get();
  const byEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (identity && byEmail && identity.userId !== byEmail.id) {
    throw new SsoFlowError("link", email);
  }

  let user = identity
    ? await db.select().from(users).where(eq(users.id, identity.userId)).get()
    : byEmail;
  let created = false;
  if (identity && !user) throw new SsoFlowError("config");
  if (user?.disabled) throw new SsoFlowError("disabled", email);

  if (!user) {
    if (!input.jitEnabled) throw new SsoFlowError("jit", email);
    const role = input.mappedRole ?? input.jitRole;
    const now = Date.now();
    const userId = crypto.randomUUID();
    try {
      await db.insert(users).values({
        id: userId,
        email,
        name: input.name.slice(0, 80) || email.slice(0, 80),
        passwordHash: null,
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
        organizationId: org.id,
        role,
        createdAt: now,
      });
      user = await db.select().from(users).where(eq(users.id, userId)).get();
      created = true;
    } catch {
      user = await db.select().from(users).where(eq(users.email, email)).get();
      created = false;
    }
    if (!user || user.disabled) throw new SsoFlowError("jit", email);
  }

  await rememberIdentity(env, input.providerId, input.subject, user.id, email);
  if (!created && input.mappedRole) {
    await syncRole(env, user.id, org.id, input.mappedRole, input.ip);
  }
  return { userId: user.id, created, email };
}

export function rulesNeedGroups(rules: readonly RoleRule[]): boolean {
  return rules.some((rule) => rule.kind === "group");
}
