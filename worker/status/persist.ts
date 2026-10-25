// SPDX-License-Identifier: MIT

import { t, textLang } from "../../shared/copy";
import { ApiError } from "../http";

const ITEM_CHUNK = 10;

export type StatusPageInsert = {
  id: string;
  organizationId: string;
  slug: string;
  published: boolean;
  serveAtRoot: boolean;
  defaultLocale: string;
  localesJson: string;
  sourceLocale: string;
  title: string;
  description: string;
  footer: string;
  banner: string;
  i18nJson: string;
  logoUrl: string | null;
  accent: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StatusPageReplace = {
  id: string;
  slug: string;
  published: boolean;
  serveAtRoot: boolean;
  touchRoot: boolean;
  title: string;
  description: string;
  footer: string;
  banner: string;
  logoUrl: string | null;
  accent: string | null;
  updatedAt: number;
};

export type StatusItemInsert = {
  id: string;
  pageId: string;
  monitorId: string;
  position: number;
  groupName: string;
  displayName: string;
};

function itemInserts(
  env: Env,
  items: StatusItemInsert[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < items.length; index += ITEM_CHUNK) {
    const chunk = items.slice(index, index + ITEM_CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    statements.push(
      env.DB.prepare(
        `INSERT INTO status_page_items (
          id, page_id, monitor_id, position, group_name, display_name, source_locale, i18n_json
        ) VALUES ${placeholders}`,
      ).bind(
        ...chunk.flatMap((item) => [
          item.id,
          item.pageId,
          item.monitorId,
          item.position,
          item.groupName,
          item.displayName,
          textLang,
          "{}",
        ]),
      ),
    );
  }
  return statements;
}

async function runBatch(
  env: Env,
  statements: D1PreparedStatement[],
): Promise<void> {
  if (statements.length === 0) return;
  try {
    if (statements.length === 1) {
      await statements[0]?.run();
      return;
    }
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/status_pages\.slug/i.test(message)) {
      throw new ApiError(409, "conflict", t("error_slug_taken"));
    }
    if (/status_page_items\.id/i.test(message)) {
      throw new ApiError(409, "conflict", t("error_layout_item"));
    }
    if (/serve_at_root|status_pages_one_root/i.test(message)) {
      throw new ApiError(409, "conflict", t("page_root_conflict"));
    }
    throw error;
  }
}

// Page, optional root handoff, and items commit in one D1 batch.
// A failed statement rolls the whole batch back, so a bad item cannot leave a page behind.
export async function createStatusPage(
  env: Env,
  page: StatusPageInsert,
  items: StatusItemInsert[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (page.serveAtRoot) {
    statements.push(
      env.DB.prepare(
        "UPDATE status_pages SET serve_at_root = 0, updated_at = ? WHERE serve_at_root = 1",
      ).bind(page.updatedAt),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO status_pages (
        id, organization_id, slug, published, serve_at_root,
        default_locale, locales_json, source_locale,
        title, description, footer, banner, i18n_json,
        logo_url, accent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      page.id,
      page.organizationId,
      page.slug,
      page.published ? 1 : 0,
      page.serveAtRoot ? 1 : 0,
      page.defaultLocale,
      page.localesJson,
      page.sourceLocale,
      page.title,
      page.description,
      page.footer,
      page.banner,
      page.i18nJson,
      page.logoUrl,
      page.accent,
      page.createdAt,
      page.updatedAt,
    ),
  );
  statements.push(...itemInserts(env, items));
  await runBatch(env, statements);
}

export async function replaceStatusPage(
  env: Env,
  page: StatusPageReplace,
  items: StatusItemInsert[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (page.touchRoot && page.published && page.serveAtRoot) {
    statements.push(
      env.DB.prepare(
        "UPDATE status_pages SET serve_at_root = 0, updated_at = ? WHERE id != ? AND serve_at_root = 1",
      ).bind(page.updatedAt, page.id),
    );
  }
  const rootSql = page.touchRoot ? ", serve_at_root = ?" : "";
  const statement = env.DB.prepare(
    `UPDATE status_pages SET
      slug = ?,
      published = ?${rootSql},
      title = ?,
      description = ?,
      footer = ?,
      banner = ?,
      logo_url = ?,
      accent = ?,
      updated_at = ?
    WHERE id = ?`,
  );
  const values: (string | number | null)[] = [
    page.slug,
    page.published ? 1 : 0,
  ];
  if (page.touchRoot) values.push(page.published && page.serveAtRoot ? 1 : 0);
  values.push(
    page.title,
    page.description,
    page.footer,
    page.banner,
    page.logoUrl,
    page.accent,
    page.updatedAt,
    page.id,
  );
  statements.push(statement.bind(...values));
  statements.push(
    env.DB.prepare("DELETE FROM status_page_items WHERE page_id = ?").bind(
      page.id,
    ),
  );
  statements.push(...itemInserts(env, items));
  await runBatch(env, statements);
}
