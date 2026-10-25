// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from "drizzle-orm";
import brand from "../brand/brand.config";
import { getDb } from "./db/client";
import { settings } from "./db/schema";

export async function readSetting<T>(
  env: Env,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await getDb(env.DB)
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (!row) return fallback;
  return JSON.parse(row.valueJson) as T;
}

export async function writeSetting(
  env: Env,
  key: string,
  value: unknown,
): Promise<void> {
  const db = getDb(env.DB);
  await db
    .insert(settings)
    .values({ key, valueJson: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { valueJson: JSON.stringify(value) },
    });
}

export async function instanceName(env: Env): Promise<string> {
  return readSetting(env, "instance_name", brand.name);
}
