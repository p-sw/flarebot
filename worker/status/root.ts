// SPDX-License-Identifier: MIT

// D1 batch runs in one transaction. The partial unique index is the backstop
// if a second row is set to 1 without clearing the first.
export async function setServeAtRoot(
  env: Env,
  pageId: string,
  enabled: boolean,
): Promise<void> {
  const now = Date.now();
  if (!enabled) {
    await env.DB.prepare(
      "UPDATE status_pages SET serve_at_root = 0, updated_at = ? WHERE id = ?",
    )
      .bind(now, pageId)
      .run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE status_pages SET serve_at_root = 0, updated_at = ? WHERE id != ? AND serve_at_root = 1",
    ).bind(now, pageId),
    env.DB.prepare(
      "UPDATE status_pages SET serve_at_root = 1, updated_at = ? WHERE id = ?",
    ).bind(now, pageId),
  ]);
}
