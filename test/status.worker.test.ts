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

  it("uses the monitor name when an item has no display name", async () => {
    const owner = await ownerSession();
    const monitor = await api(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Named probe",
          type: "heartbeat",
          config: { graceSeconds: 30 },
          intervalSeconds: 60,
        }),
      },
      owner,
    );
    expect(monitor.status).toBe(201);
    const monitorId = ((await monitor.json()) as { id: string }).id;
    const slug = `names-${crypto.randomUUID().slice(0, 8)}`;
    const created = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Names",
          description: "",
          items: [
            {
              monitorId,
              position: 0,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
              i18n: {},
            },
          ],
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const body = (await (await api(`/api/public/status/${slug}`)).json()) as {
      groups: { name: string; items: { name: string }[] }[];
    };
    expect(body.groups[0]?.name).toBe("Core");
    expect(body.groups[0]?.items[0]?.name).toBe("Named probe");
    expect(body.groups[0]?.items[0]?.name).not.toBe("Core");
    expect(body.groups[0]?.items[0]?.name).not.toBe(monitorId);
    const id = ((await created.json()) as { id: string }).id;
    const detail = (await (
      await api(`/api/status-pages/${id}`, {}, owner)
    ).json()) as {
      items: { monitorId: string; monitorName: string }[];
    };
    expect(detail.items[0]?.monitorName).toBe("Named probe");
    expect(detail.items[0]?.monitorName).not.toBe(monitorId);
  });

  it("stores section order and rolls a failed create back", async () => {
    const owner = await ownerSession();
    const slug = `order-${crypto.randomUUID().slice(0, 8)}`;
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM status_pages WHERE slug = ?",
    )
      .bind(slug)
      .first<{ n: number }>();
    const invalid = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug: "Not A Slug",
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Nope",
          items: [
            {
              monitorId: crypto.randomUUID(),
              position: 0,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
            },
          ],
        }),
      },
      owner,
    );
    expect(invalid.status).toBe(400);
    const unknown = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Nope",
          items: [
            {
              monitorId: crypto.randomUUID(),
              position: 0,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
            },
          ],
        }),
      },
      owner,
    );
    expect(unknown.status).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM status_pages WHERE slug = ?",
        )
          .bind(slug)
          .first<{ n: number }>()
      )?.n,
    ).toBe(before?.n ?? 0);

    async function monitor(name: string) {
      const response = await api(
        "/api/monitors",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            type: "heartbeat",
            config: { graceSeconds: 30 },
            intervalSeconds: 60,
          }),
        },
        owner,
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    }
    const alpha = await monitor("Alpha probe");
    const beta = await monitor("Beta probe");
    const sharedId = crypto.randomUUID();
    const duplicate = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Rollback",
          items: [
            {
              id: sharedId,
              monitorId: alpha,
              position: 0,
              groupName: "Edge",
              displayName: "",
              sourceLocale: "en",
            },
            {
              id: sharedId,
              monitorId: beta,
              position: 1,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
            },
          ],
        }),
      },
      owner,
    );
    expect(duplicate.status).not.toBe(201);
    expect(
      await env.DB.prepare("SELECT id FROM status_pages WHERE slug = ?")
        .bind(slug)
        .first(),
    ).toBeNull();

    const created = await api(
      "/api/status-pages",
      {
        method: "POST",
        body: JSON.stringify({
          slug,
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Ordered",
          description: "Ready",
          items: [
            {
              monitorId: beta,
              position: 0,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
            },
            {
              monitorId: alpha,
              position: 1,
              groupName: "Edge",
              displayName: "Edge API",
              sourceLocale: "en",
            },
          ],
        }),
      },
      owner,
    );
    expect(created.status).toBe(201);
    const pageId = ((await created.json()) as { id: string }).id;
    const reversed = await api(
      `/api/status-pages/${pageId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          slug,
          published: true,
          defaultLocale: "en",
          locales: ["en"],
          sourceLocale: "en",
          title: "Ordered",
          description: "Ready",
          items: [
            {
              monitorId: alpha,
              position: 0,
              groupName: "Edge",
              displayName: "",
              sourceLocale: "en",
            },
            {
              monitorId: beta,
              position: 1,
              groupName: "Core",
              displayName: "",
              sourceLocale: "en",
            },
          ],
        }),
      },
      owner,
    );
    expect(reversed.status).toBe(200);
    const body = (await (await api(`/api/public/status/${slug}`)).json()) as {
      groups: { name: string; items: { name: string }[] }[];
    };
    expect(body.groups.map((group) => group.name)).toEqual(["Edge", "Core"]);
    expect(body.groups[0]?.items[0]?.name).toBe("Alpha probe");
    expect(body.groups[1]?.items[0]?.name).toBe("Beta probe");
    const rows = await env.DB.prepare(
      "SELECT group_name AS groupName, position FROM status_page_items WHERE page_id = ? ORDER BY position",
    )
      .bind(pageId)
      .all<{ groupName: string; position: number }>();
    expect(rows.results.map((row) => row.groupName)).toEqual(["Edge", "Core"]);
    expect(rows.results.map((row) => row.position)).toEqual([0, 1]);
  });
});
