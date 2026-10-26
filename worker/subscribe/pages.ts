// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import { t, textLang } from "../../shared/copy";
import { xmlEscape } from "../../shared/subscriptions";
import { getDb } from "../db/client";
import { statusPages } from "../db/schema";
import { confirmSubscriber, unsubscribeSubscriber } from "./store";

export async function confirmResponse(
  env: Env,
  token: string,
  origin: string,
): Promise<Response> {
  const result = await confirmSubscriber(env, token);
  if (!("pageId" in result)) {
    const expired = result.state === "expired";
    return html(
      expired
        ? t("subscribe_confirm_expired_title")
        : t("subscribe_confirm_invalid_title"),
      expired
        ? t("subscribe_confirm_expired_body")
        : t("subscribe_confirm_invalid_body"),
      [],
    );
  }
  const page = await getDb(env.DB)
    .select()
    .from(statusPages)
    .where(eq(statusPages.id, result.pageId))
    .get();
  const href = page
    ? page.serveAtRoot
      ? `${origin}/`
      : `${origin}/s/${page.slug}`
    : origin;
  const title =
    result.state === "already"
      ? t("subscribe_confirm_already_title")
      : t("subscribe_confirmed_title");
  const body =
    result.state === "already"
      ? t("subscribe_confirm_already_body")
      : t("subscribe_confirmed_body", { page: page?.title ?? "" });
  return html(title, body, [{ href, label: t("subscribe_back_status") }]);
}

export async function unsubscribeResponse(
  env: Env,
  token: string,
): Promise<Response> {
  const result = await unsubscribeSubscriber(env, token);
  if (result === "invalid") {
    return html(
      t("subscribe_token_invalid_title"),
      t("subscribe_token_invalid_body"),
      [],
    );
  }
  return html(
    result === "already"
      ? t("subscribe_unsubscribed_already_title")
      : t("subscribe_unsubscribed_title"),
    result === "already"
      ? t("subscribe_unsubscribed_already_body")
      : t("subscribe_unsubscribed_body"),
    [],
  );
}

function html(
  title: string,
  body: string,
  links: { href: string; label: string }[],
): Response {
  const actions = links
    .map(
      (link) =>
        `<p><a href="${xmlEscape(link.href)}">${xmlEscape(link.label)}</a></p>`,
    )
    .join("");
  const document = `<!doctype html>
<html lang="${xmlEscape(textLang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${xmlEscape(title)}</title>
<style>
  body { margin: 0; font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
  main { max-width: 32rem; margin: 10vh auto; padding: 1.5rem; background: #fff; border: 1px solid #e4e4e7; border-radius: 0.75rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { line-height: 1.5; }
  a { color: #2563eb; }
</style>
</head>
<body>
<main>
  <h1>${xmlEscape(title)}</h1>
  <p>${xmlEscape(body)}</p>
  ${actions}
</main>
</body>
</html>`;
  return new Response(document, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
