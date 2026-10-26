// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import {
  FEED_CACHE_SECONDS,
  FEED_ITEM_CAP,
  type FeedEntry,
  renderAtom,
  renderRss,
} from "../../shared/subscriptions";
import { getDb } from "../db/client";
import { statusPages } from "../db/schema";

export async function feedResponse(
  env: Env,
  request: Request,
  slug: string | null,
  format: "rss" | "atom",
): Promise<Response> {
  const cached = await readCache(request);
  if (cached) return cached;
  const page = slug
    ? await getDb(env.DB)
        .select()
        .from(statusPages)
        .where(eq(statusPages.slug, slug))
        .get()
    : await getDb(env.DB)
        .select()
        .from(statusPages)
        .where(eq(statusPages.serveAtRoot, true))
        .get();
  if (!page?.published || !page.subscribeRss) {
    return new Response(null, { status: 404 });
  }
  const rows = await env.DB.prepare(
    `SELECT id, title, summary, href, created_at AS occurredAt
     FROM announcement_events
     WHERE organization_id = ?
       AND (
         (subject_type = 'incident' AND subject_id IN (
           SELECT incident_id FROM incident_pages WHERE page_id = ?
         ))
         OR
         (subject_type = 'maintenance' AND subject_id IN (
           SELECT maintenance_id FROM maintenance_pages WHERE page_id = ?
         ))
       )
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(page.organizationId, page.id, page.id, FEED_ITEM_CAP)
    .all<FeedEntry & { occurredAt: number }>();
  const url = new URL(request.url);
  const origin = url.origin;
  const pageUrl = page.serveAtRoot ? `${origin}/` : `${origin}/s/${page.slug}`;
  const selfUrl = url.origin + url.pathname;
  const items: FeedEntry[] = rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    href: row.href,
    occurredAt: row.occurredAt,
  }));
  const body =
    format === "rss"
      ? renderRss({
          title: page.title,
          description: page.description,
          pageUrl,
          selfUrl,
          items,
        })
      : renderAtom({ title: page.title, pageUrl, selfUrl, items });
  const headers = {
    "content-type":
      format === "rss"
        ? "application/rss+xml; charset=utf-8"
        : "application/atom+xml; charset=utf-8",
    "cache-control": `public, max-age=${FEED_CACHE_SECONDS}`,
  };
  const response = new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
  await writeCache(request, response);
  return response;
}

async function readCache(request: Request): Promise<Response | null> {
  try {
    return (await caches.default.match(request)) ?? null;
  } catch {
    return null;
  }
}

async function writeCache(request: Request, response: Response): Promise<void> {
  try {
    await caches.default.put(request, response.clone());
  } catch {
    // The cache API is optional in tests.
  }
}
