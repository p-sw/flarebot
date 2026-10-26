// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import { mailSettings } from "../db/schema";
import { resolveMail } from "../mail/resolve";
import { readSetting } from "../settings-store";

export const TURNSTILE_SETTING_KEY = "turnstile_subscribe";
export const ALLOW_HTTP_KEY = "subscribe_allow_http";

type StoredTurnstile = {
  siteKey: string;
  secretEncrypted: string | null;
};

export async function mailIsConfigured(env: Env): Promise<boolean> {
  const row = await getDb(env.DB)
    .select()
    .from(mailSettings)
    .where(eq(mailSettings.id, 1))
    .get();
  const resolved = await resolveMail(env, row ?? null);
  if (resolved.driver === "none" || !resolved.fromAddress) return false;
  if (resolved.driver === "cf-email" && !env.EMAIL) return false;
  return true;
}

export async function allowHttpWebhooks(env: Env): Promise<boolean> {
  return Boolean(await readSetting(env, ALLOW_HTTP_KEY, false));
}

export async function subscribeTurnstile(env: Env): Promise<{
  siteKey: string;
  secret: string;
  source: "settings" | "env";
} | null> {
  const stored = await readSetting<StoredTurnstile | null>(
    env,
    TURNSTILE_SETTING_KEY,
    null,
  );
  if (stored?.siteKey && stored.secretEncrypted && env.ENCRYPTION_KEY) {
    try {
      const secret = await decryptString(
        env.ENCRYPTION_KEY,
        stored.secretEncrypted,
      );
      if (secret)
        return { siteKey: stored.siteKey, secret, source: "settings" };
    } catch {
      // Fall through to Worker secrets when the stored ciphertext cannot be read.
    }
  }
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    return {
      siteKey: env.TURNSTILE_SITE_KEY,
      secret: env.TURNSTILE_SECRET_KEY,
      source: "env",
    };
  }
  return null;
}

export async function publicSubscriptionState(
  env: Env,
  page: {
    subscribeEmail: boolean;
    subscribeWebhook: boolean;
    subscribeRss: boolean;
  },
  components: { id: string; name: string }[],
): Promise<{
  email: boolean;
  webhook: boolean;
  rss: boolean;
  turnstileSiteKey: string | null;
  components: { id: string; name: string }[];
}> {
  const [mail, turnstile] = await Promise.all([
    mailIsConfigured(env),
    subscribeTurnstile(env),
  ]);
  return {
    email: page.subscribeEmail && mail,
    webhook: page.subscribeWebhook,
    rss: page.subscribeRss,
    turnstileSiteKey: turnstile?.siteKey ?? null,
    components,
  };
}
