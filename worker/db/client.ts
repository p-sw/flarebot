// SPDX-License-Identifier: MIT

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(database: D1Database) {
  return drizzle(database, { schema });
}

export type Database = ReturnType<typeof getDb>;

/**
 * D1 allows 100 bound parameters per statement. Lists that a schema lets
 * grow past that (page items, linked monitors) are read and written in
 * pieces. 80 leaves room for the other conditions of the statement.
 */
export const D1_ID_CHUNK = 80;

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/** Runs one query per piece of the id list and joins the rows. */
export async function selectByIds<T, R>(
  ids: readonly T[],
  run: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const unique = [...new Set(ids)];
  if (unique.length <= D1_ID_CHUNK) return unique.length ? run(unique) : [];
  const parts = await Promise.all(chunked(unique, D1_ID_CHUNK).map(run));
  return parts.flat();
}
