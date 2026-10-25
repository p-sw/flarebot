// SPDX-License-Identifier: AGPL-3.0-only

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
          defaultLocale: "en",
          locales: ["en", "ko"],
          sourceLocale: "en",
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
          defaultLocale: "en",
          locales: ["en", "ko"],
          sourceLocale: "en",
          title: "Source title",
          description: "Source description",
          footer: "",
          i18n: { ko: { title: "Status KO" } },
          items: [
            {
              monitorId,
              position: 0,
              groupName: "Core",
              displayName: "Heartbeat",
              sourceLocale: "en",
              i18n: { ko: { displayName: "Heartbeat KO" } },
            },
          ],
        }),
      },
      owner,
    );
    expect(page.status).toBe(201);
    const korean = await api("/api/public/status/public-page?lang=ko");
    const body = (await korean.json()) as {
      title: string;
      description: string;
      langs: Record<string, string>;
      groups: { items: { name: string; status: string }[] }[];
    };
    expect(body.title).toBe("Status KO");
    expect(body.description).toBe("Source description");
    expect(body.langs.title).toBe("ko");
    expect(body.langs.description).toBe("en");
    expect(body.groups[0]?.items[0]?.name).toBe("Heartbeat KO");
    expect(JSON.stringify(body)).not.toContain("https://");

    const header = await api("/api/public/status/public-page", {
      headers: { "accept-language": "ko-KR,ko;q=0.9,en;q=0.4" },
    });
    expect(((await header.json()) as { title: string }).title).toBe(
      "Status KO",
    );

    const html = await api("/s/public-page?lang=ko");
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain('<html lang="ko"');
    expect(text).toContain("Status KO");
    expect(text).toContain(`hreflang="ko"`);
    expect(text).toContain(`${origin}/s/public-page`);
    expect((await api("/s/hidden-page")).status).toBe(404);
  });
});
