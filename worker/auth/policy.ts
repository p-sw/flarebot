// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import { t } from "../../shared/copy";
import { parsePolicy, SSO_POLICY_KEY, type SsoPolicy } from "../../shared/sso";
import { getDb } from "../db/client";
import { memberships } from "../db/schema";
import { ApiError } from "../http";
import { readSetting, writeSetting } from "../settings-store";

export async function readPolicy(env: Env): Promise<SsoPolicy> {
  return parsePolicy(await readSetting(env, SSO_POLICY_KEY, null));
}

export async function writePolicy(env: Env, policy: SsoPolicy): Promise<void> {
  await writeSetting(env, SSO_POLICY_KEY, policy);
}

export async function assertLocalLoginAllowed(
  env: Env,
  userId: string,
): Promise<void> {
  const policy = await readPolicy(env);
  if (!policy.hideLocalLogin) return;
  const membership = await getDb(env.DB)
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .get();
  if (membership?.role === "owner") return;
  throw new ApiError(403, "local_hidden", t("error_local_hidden"));
}
