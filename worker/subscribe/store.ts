// SPDX-License-Identifier: MIT

import { and, eq } from "drizzle-orm";
import { t } from "../../shared/copy";
import {
  parseMonitorIds,
  rateBucket,
  SUBSCRIPTION_ADDRESS_LIMIT,
  SUBSCRIPTION_CONFIRM_MS,
  SUBSCRIPTION_IP_LIMIT,
  SUBSCRIPTION_PENDING_CAP,
} from "../../shared/subscriptions";
import { encryptString, randomToken, sha256Hex } from "../crypto/secret";
import { getDb } from "../db/client";
import {
  monitors,
  statusPageItems,
  statusPages,
  subscribers,
  subscriptionTokens,
} from "../db/schema";
import { ApiError } from "../http";

export async function limited(
  env: Env,
  kind: "ip" | "addr",
  hash: string,
  now = Date.now(),
): Promise<boolean> {
  const slot = rateBucket(kind, hash, now);
  const limit =
    kind === "ip" ? SUBSCRIPTION_IP_LIMIT : SUBSCRIPTION_ADDRESS_LIMIT;
  await env.DB.prepare(
    `INSERT INTO subscription_limits (bucket, hits, window_start)
     VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1`,
  )
    .bind(slot.bucket, slot.windowStart)
    .run();
  const row = await env.DB.prepare(
    "SELECT hits FROM subscription_limits WHERE bucket = ?",
  )
    .bind(slot.bucket)
    .first<{ hits: number }>();
  return (row?.hits ?? 1) > limit;
}

export async function pendingCount(env: Env, pageId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subscribers WHERE status_page_id = ? AND status = 'pending'",
  )
    .bind(pageId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export function assertChoice(
  followAll: boolean,
  monitorIds: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  if (followAll) return [];
  if (monitorIds.length === 0) {
    throw new ApiError(400, "validation", t("error_subscribe_monitors"));
  }
  const unique = [...new Set(monitorIds)];
  if (unique.some((id) => !allowed.has(id))) {
    throw new ApiError(400, "validation", t("error_subscribe_monitors"));
  }
  return unique;
}

export async function pageMonitorIds(
  env: Env,
  pageId: string,
): Promise<Map<string, string>> {
  const db = getDb(env.DB);
  const items = await db
    .select()
    .from(statusPageItems)
    .where(eq(statusPageItems.pageId, pageId));
  const names = await db
    .select({ id: monitors.id, name: monitors.name })
    .from(monitors);
  const nameById = new Map(names.map((row) => [row.id, row.name]));
  const result = new Map<string, string>();
  for (const item of items) {
    const label = item.displayName.trim() || nameById.get(item.monitorId) || "";
    result.set(item.monitorId, label);
  }
  return result;
}

export async function mintToken(
  env: Env,
  subscriberId: string,
  purpose: "confirm" | "manage" | "unsubscribe",
  expiresAt: number | null,
): Promise<{ token: string; hash: string }> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  await getDb(env.DB).insert(subscriptionTokens).values({
    tokenHash: hash,
    subscriberId,
    purpose,
    expiresAt,
    createdAt: Date.now(),
  });
  return { token, hash };
}

export type EmailSave =
  | {
      action: "confirm";
      email: string;
      confirm: string;
      manage: string;
      unsubscribe: string;
    }
  | {
      action: "already";
      email: string;
      manage: string;
      unsubscribe: string;
    };

export async function saveEmailSubscriber(
  env: Env,
  input: {
    organizationId: string;
    pageId: string;
    origin: string;
    email: string;
    followAll: boolean;
    monitorIds: string[];
  },
): Promise<EmailSave> {
  const email = input.email.trim().toLowerCase();
  const hash = await sha256Hex(`${input.pageId}:email:${email}`);
  const db = getDb(env.DB);
  const existing = await db
    .select()
    .from(subscribers)
    .where(
      and(
        eq(subscribers.statusPageId, input.pageId),
        eq(subscribers.addressHash, hash),
      ),
    )
    .get();
  if (existing?.status === "confirmed") {
    return {
      action: "already",
      email,
      manage: "",
      unsubscribe: "",
    };
  }
  if (
    !existing &&
    (await pendingCount(env, input.pageId)) >= SUBSCRIPTION_PENDING_CAP
  ) {
    throw new ApiError(429, "subscribe_cap", t("error_subscribe_cap"));
  }
  const now = Date.now();
  const monitorIdsJson = JSON.stringify(
    input.followAll ? [] : input.monitorIds,
  );
  const id = existing?.id ?? crypto.randomUUID();
  const expires = now + SUBSCRIPTION_CONFIRM_MS;
  if (!existing) {
    await db.insert(subscribers).values({
      id,
      organizationId: input.organizationId,
      statusPageId: input.pageId,
      kind: "email",
      status: "pending",
      email,
      addressHash: hash,
      webhookUrlEncrypted: null,
      webhookSecretEncrypted: null,
      followAll: input.followAll,
      monitorIdsJson,
      confirmTokenHash: `confirm-${id}`,
      manageTokenHash: `manage-${id}`,
      unsubTokenHash: `unsub-${id}`,
      confirmExpiresAt: expires,
      failCount: 0,
      origin: input.origin,
      createdAt: now,
      confirmedAt: null,
      disabledAt: null,
      disabledReason: null,
    });
  } else {
    await db
      .update(subscribers)
      .set({
        status: "pending",
        email,
        followAll: input.followAll,
        monitorIdsJson,
        confirmExpiresAt: expires,
        origin: input.origin,
        disabledAt: null,
        disabledReason: null,
        confirmedAt: null,
      })
      .where(eq(subscribers.id, existing.id));
  }
  const confirm = await mintToken(env, id, "confirm", expires);
  const manage = await mintToken(env, id, "manage", null);
  const unsubscribe = await mintToken(env, id, "unsubscribe", null);
  await db
    .update(subscribers)
    .set({
      confirmTokenHash: confirm.hash,
      manageTokenHash: manage.hash,
      unsubTokenHash: unsubscribe.hash,
    })
    .where(eq(subscribers.id, id));
  return {
    action: "confirm",
    email,
    confirm: confirm.token,
    manage: manage.token,
    unsubscribe: unsubscribe.token,
  };
}

export async function rememberConfirmedLinks(
  env: Env,
  pageId: string,
  email: string,
): Promise<{ manage: string; unsubscribe: string } | null> {
  const hash = await sha256Hex(`${pageId}:email:${email.trim().toLowerCase()}`);
  const existing = await getDb(env.DB)
    .select()
    .from(subscribers)
    .where(
      and(
        eq(subscribers.statusPageId, pageId),
        eq(subscribers.addressHash, hash),
      ),
    )
    .get();
  if (existing?.status !== "confirmed") return null;
  const manage = await mintToken(env, existing.id, "manage", null);
  const unsubscribe = await mintToken(env, existing.id, "unsubscribe", null);
  await getDb(env.DB)
    .update(subscribers)
    .set({
      manageTokenHash: manage.hash,
      unsubTokenHash: unsubscribe.hash,
    })
    .where(eq(subscribers.id, existing.id));
  return { manage: manage.token, unsubscribe: unsubscribe.token };
}

export async function saveWebhookSubscriber(
  env: Env,
  input: {
    organizationId: string;
    pageId: string;
    origin: string;
    href: string;
    secret: string;
    followAll: boolean;
    monitorIds: string[];
  },
): Promise<{ id: string; replaced: boolean }> {
  if (!env.ENCRYPTION_KEY) {
    throw new ApiError(400, "subscribe_mail", t("error_subscribe_encryption"));
  }
  const hash = await sha256Hex(`${input.pageId}:webhook:${input.href}`);
  const db = getDb(env.DB);
  const existing = await db
    .select()
    .from(subscribers)
    .where(
      and(
        eq(subscribers.statusPageId, input.pageId),
        eq(subscribers.addressHash, hash),
      ),
    )
    .get();
  if (existing?.status === "confirmed") {
    throw new ApiError(409, "subscribe_exists", t("error_subscribe_exists"));
  }
  const now = Date.now();
  const id = existing?.id ?? crypto.randomUUID();
  const placeholder = {
    kind: "webhook" as const,
    status: "confirmed" as const,
    email: null,
    addressHash: hash,
    webhookUrlEncrypted: await encryptString(env.ENCRYPTION_KEY, input.href),
    webhookSecretEncrypted: await encryptString(
      env.ENCRYPTION_KEY,
      input.secret,
    ),
    followAll: input.followAll,
    monitorIdsJson: JSON.stringify(input.followAll ? [] : input.monitorIds),
    confirmTokenHash: null,
    manageTokenHash: `manage-${id}`,
    unsubTokenHash: `unsub-${id}`,
    confirmExpiresAt: null,
    failCount: 0,
    origin: input.origin,
    confirmedAt: now,
    disabledAt: null,
    disabledReason: null,
  };
  if (!existing) {
    await db.insert(subscribers).values({
      id,
      organizationId: input.organizationId,
      statusPageId: input.pageId,
      createdAt: now,
      ...placeholder,
    });
  } else {
    await db.update(subscribers).set(placeholder).where(eq(subscribers.id, id));
  }
  const manage = await mintToken(env, id, "manage", null);
  const unsubscribe = await mintToken(env, id, "unsubscribe", null);
  await db
    .update(subscribers)
    .set({
      manageTokenHash: manage.hash,
      unsubTokenHash: unsubscribe.hash,
    })
    .where(eq(subscribers.id, id));
  return { id, replaced: Boolean(existing) };
}

export async function findByToken(
  env: Env,
  purpose: "confirm" | "manage" | "unsubscribe",
  token: string,
) {
  const hash = await sha256Hex(token);
  const db = getDb(env.DB);
  const link = await db
    .select()
    .from(subscriptionTokens)
    .where(eq(subscriptionTokens.tokenHash, hash))
    .get();
  if (!link || link.purpose !== purpose) return null;
  const row = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, link.subscriberId))
    .get();
  if (!row) return null;
  return { row, expiresAt: link.expiresAt };
}

export async function confirmSubscriber(
  env: Env,
  token: string,
): Promise<
  | { state: "confirmed" | "already"; pageId: string }
  | { state: "invalid" | "expired" }
> {
  const found = await findByToken(env, "confirm", token);
  if (!found) return { state: "invalid" };
  const row = found.row;
  if (row.status === "confirmed")
    return { state: "already", pageId: row.statusPageId };
  if (row.status !== "pending") return { state: "invalid" };
  if (found.expiresAt && found.expiresAt < Date.now())
    return { state: "expired" };
  await getDb(env.DB)
    .update(subscribers)
    .set({
      status: "confirmed",
      confirmedAt: Date.now(),
      confirmExpiresAt: null,
      disabledAt: null,
      disabledReason: null,
    })
    .where(eq(subscribers.id, row.id));
  return { state: "confirmed", pageId: row.statusPageId };
}

export async function unsubscribeSubscriber(
  env: Env,
  token: string,
): Promise<"done" | "already" | "invalid"> {
  const found =
    (await findByToken(env, "unsubscribe", token)) ??
    (await findByToken(env, "manage", token));
  if (!found) return "invalid";
  if (
    found.row.status === "disabled" &&
    found.row.disabledReason === "unsubscribe"
  ) {
    return "already";
  }
  await getDb(env.DB)
    .update(subscribers)
    .set({
      status: "disabled",
      disabledAt: Date.now(),
      disabledReason: "unsubscribe",
      confirmTokenHash: null,
    })
    .where(eq(subscribers.id, found.row.id));
  return "done";
}

export async function manageView(env: Env, token: string) {
  const found = await findByToken(env, "manage", token);
  if (!found || found.row.status === "disabled") return null;
  const page = await getDb(env.DB)
    .select()
    .from(statusPages)
    .where(eq(statusPages.id, found.row.statusPageId))
    .get();
  if (!page) return null;
  const components = await pageMonitorIds(env, page.id);
  return {
    row: found.row,
    page,
    components: [...components.entries()].map(([id, name]) => ({ id, name })),
    monitorIds: parseMonitorIds(found.row.monitorIdsJson),
  };
}

export async function updatePreferences(
  env: Env,
  token: string,
  followAll: boolean,
  monitorIds: string[],
): Promise<void> {
  const view = await manageView(env, token);
  if (view?.row.status !== "confirmed") {
    throw new ApiError(404, "subscribe_token", t("error_subscribe_token"));
  }
  const allowed = new Set(view.components.map((item) => item.id));
  const chosen = assertChoice(followAll, monitorIds, allowed);
  await getDb(env.DB)
    .update(subscribers)
    .set({
      followAll,
      monitorIdsJson: JSON.stringify(chosen),
    })
    .where(eq(subscribers.id, view.row.id));
}
