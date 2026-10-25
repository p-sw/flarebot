// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, origin, ownerSession } from "./helpers";

describe("status pages", () => {
  it("hides unpublished pages and falls back per field", async () => {
    const owner = await ownerSession();
    const monitor = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Status HTTP",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
        }),
      },
      owner,
    );
    expect(monitor.status).toBe(201);
    const monitorId = ((await monitor.json()) as { id: string }).id;
    const hidden = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: "hidden-page",
          published: false,
          title: "Hidden",
          description: "secret target https://internal.example",
          items: [],
        }),
      },
      owner,
    );
    expect(hidden.status).toBe(201);
    expect((await api("/api/public/status/hidden-page")).status).toBe(404);

    const page = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: "public-page",
          published: true,
          title: "Source title",
          description: "Source description",
          footer: "",
          items: [
            {
              monitorId,
              position: 0,
              groupName: "Core",
              displayName: "Heartbeat",
            },
          ],
        }),
      },
      owner,
    );
    expect(page.status).toBe(201);
    await env.DB.prepare(
      "UPDATE status_pages SET i18n_json = ?, locales_json = ?, default_locale = ? WHERE slug = ?",
    )
      .bind(
        JSON.stringify({
          ko: { title: "Status KO", description: "Ignored description" },
        }),
        JSON.stringify(["en", "ko"]),
        "ko",
        "public-page",
      )
      .run();
    await env.DB.prepare(
      "UPDATE status_page_items SET i18n_json = ? WHERE display_name = ?",
    )
      .bind(
        JSON.stringify({ ko: { displayName: "Heartbeat KO" } }),
        "Heartbeat",
      )
      .run();

    const korean = await api("/api/public/status/public-page?lang=ko", {
      headers: {
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.4",
        cookie: "locale=ko",
      },
    });
    const body = (await korean.json()) as {
      title: string;
      description: string;
      groups: { items: { name: string; status: string }[] }[];
    };
    expect(body.title).toBe("Source title");
    expect(body.description).toBe("Source description");
    expect(body.groups[0]?.items[0]?.name).toBe("Heartbeat");
    expect(JSON.stringify(body)).not.toContain("Status KO");
    expect(JSON.stringify(body)).not.toContain("https://");
    expect(korean.headers.get("vary")).toBeNull();

    const html = await api("/s/public-page?lang=ko", {
      headers: {
        "accept-language": "ko-KR,ko;q=0.9",
        cookie: "locale=ko",
      },
    });
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain('<html lang="en"');
    expect(text).toContain("Source title");
    expect(text).not.toContain("hreflang");
    expect(text).not.toContain("Status KO");
    expect(text).toContain(`${origin}/s/public-page`);
    expect(html.headers.get("vary")).toBeNull();
    expect((await api("/s/hidden-page")).status).toBe(404);
  });
});
