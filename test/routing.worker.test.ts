// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  decideFrontDoor,
  legacyConsoleLocation,
  safeReturnPath,
} from "../shared/front-door";
import { api, origin, ownerSession } from "./helpers";

describe("front door decisions", () => {
  it("keeps return paths on this origin", () => {
    expect(safeReturnPath("/console")).toBe("/console");
    expect(safeReturnPath("/console/monitors/abc?x=1#y")).toBe(
      "/console/monitors/abc?x=1#y",
    );
    expect(safeReturnPath("https://evil.example/console")).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("/%2f%2fevil.example")).toBeNull();
    expect(safeReturnPath("/console\nSet-Cookie: a=b")).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("sends old admin URLs to /console and resolves the root", () => {
    expect(legacyConsoleLocation("/monitors/abc", "?x=1")).toBe(
      "/console/monitors/abc?x=1",
    );
    expect(legacyConsoleLocation("/settings")).toBe("/console/settings");
    expect(legacyConsoleLocation("/s/status")).toBeNull();
    expect(legacyConsoleLocation("/api/meta")).toBeNull();

    const base = {
      search: "",
      setupRequired: false,
      authenticated: false,
      rootAvailable: false,
    };
    expect(decideFrontDoor({ ...base, pathname: "/setup" })).toEqual({
      type: "redirect",
      location: "/login",
    });
    expect(
      decideFrontDoor({ ...base, pathname: "/setup", setupRequired: true }),
    ).toEqual({ type: "spa" });
    expect(
      decideFrontDoor({ ...base, pathname: "/login", setupRequired: true }),
    ).toEqual({ type: "redirect", location: "/setup" });
    expect(
      decideFrontDoor({
        ...base,
        pathname: "/login",
        search: "?next=https://evil.example",
        authenticated: true,
      }),
    ).toEqual({ type: "redirect", location: "/console" });
    expect(
      decideFrontDoor({
        ...base,
        pathname: "/console/status-pages",
        search: "?x=1",
      }),
    ).toEqual({
      type: "redirect",
      location: "/login?next=%2Fconsole%2Fstatus-pages%3Fx%3D1",
    });
    expect(
      decideFrontDoor({
        ...base,
        pathname: "/",
        authenticated: true,
      }),
    ).toEqual({ type: "redirect", location: "/login" });
    expect(
      decideFrontDoor({ ...base, pathname: "/", rootAvailable: true }),
    ).toEqual({ type: "public-root" });
    expect(decideFrontDoor({ ...base, pathname: "/forgot" })).toEqual({
      type: "ignore",
    });
    expect(
      decideFrontDoor({ ...base, pathname: "/monitors/abc", search: "?x=1" }),
    ).toEqual({
      type: "redirect",
      location: "/console/monitors/abc?x=1",
    });
  });
});

describe("root status page routing", () => {
  it("redirects / to login until a published page is the root", async () => {
    const meta = (await (await api("/api/meta")).json()) as {
      setupRequired: boolean;
    };
    if (meta.setupRequired) {
      expect((await api("/login")).headers.get("location")).toBe("/setup");
      expect((await api("/")).headers.get("location")).toBe("/login");
      expect((await api("/")).headers.get("cache-control")).toContain(
        "no-store",
      );
    }

    const owner = await ownerSession();
    await env.DB.prepare("UPDATE status_pages SET serve_at_root = 0").run();
    const home = await api("/", {}, owner);
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("/login");
    const login = await api("/login?next=https://evil.example", {}, owner);
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/console");
    expect(login.headers.get("location")).not.toContain("evil");
    const setup = await api("/setup", {}, owner);
    expect(setup.headers.get("location")).toBe("/login");

    const deep = await api("/console/status-pages?x=1");
    expect(deep.status).toBe(302);
    expect(deep.headers.get("location")).toBe(
      "/login?next=%2Fconsole%2Fstatus-pages%3Fx%3D1",
    );
    expect(deep.headers.get("cache-control")).toContain("no-store");

    const legacy = await api("/monitors/abc?x=1");
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe("/console/monitors/abc?x=1");
    expect((await api("/channels")).headers.get("location")).toBe(
      "/console/channels",
    );
    expect((await api("/api/health")).status).toBe(200);
    expect((await api("/forgot")).status).not.toBe(302);
    expect((await api("/login")).status).not.toBe(302);
  });

  it("allows one published root and keeps the slug URL", async () => {
    const owner = await ownerSession();
    const stamp = crypto.randomUUID().slice(0, 8);
    const alpha = await createPage(owner, `root-a-${stamp}`, "Root Alpha");
    const beta = await createPage(owner, `root-b-${stamp}`, "Root Beta");
    const hidden = await createPage(
      owner,
      `root-h-${stamp}`,
      "Root Hidden",
      false,
    );

    const denied = await api(
      `/api/status-pages/${hidden}/root`,
      { method: "PUT", body: JSON.stringify({ serveAtRoot: true }) },
      owner,
    );
    expect(denied.status).toBe(400);

    expect(
      (
        await api(
          `/api/status-pages/${alpha}/root`,
          { method: "PUT", body: JSON.stringify({ serveAtRoot: true }) },
          owner,
        )
      ).status,
    ).toBe(200);
    await expect(
      env.DB.prepare("UPDATE status_pages SET serve_at_root = 1 WHERE id = ?")
        .bind(beta)
        .run(),
    ).rejects.toThrow();
    const stuck = await env.DB.prepare(
      "SELECT serve_at_root AS root FROM status_pages WHERE id = ?",
    )
      .bind(alpha)
      .first<{ root: number }>();
    expect(stuck?.root).toBe(1);

    expect(
      (
        await api(
          `/api/status-pages/${beta}/root`,
          { method: "PUT", body: JSON.stringify({ serveAtRoot: true }) },
          owner,
        )
      ).status,
    ).toBe(200);
    const roots = await env.DB.prepare(
      "SELECT id FROM status_pages WHERE serve_at_root = 1",
    ).all<{ id: string }>();
    expect(roots.results.map((row) => row.id)).toEqual([beta]);

    const html = await api("/");
    expect(html.status).toBe(200);
    expect(html.headers.get("cache-control")).toContain("no-store");
    const text = await html.text();
    expect(text).toContain("<title>Root Beta</title>");
    expect(text.match(/<title>/g)).toHaveLength(1);
    expect(text).toContain(`href="${origin}/"`);
    expect(text).not.toContain("<title>Flarebot</title>");

    const slug = await api(`/s/root-b-${stamp}`);
    expect(slug.status).toBe(200);
    expect(await slug.text()).toContain(`href="${origin}/"`);
    const other = await api(`/s/root-a-${stamp}`);
    expect(other.status).toBe(200);
    expect(await other.text()).toContain(`${origin}/s/root-a-${stamp}`);

    const korean = await api("/", {
      headers: {
        "accept-language": "ko-KR,ko;q=0.9",
        cookie: "locale=ko",
      },
    });
    expect(korean.headers.get("vary")).toBeNull();
    const koreanText = await korean.text();
    expect(koreanText).toContain('<html lang="en"');
    expect(koreanText).toContain("<title>Root Beta</title>");
    expect(koreanText).not.toContain("hreflang");

    const unpublished = await api(
      `/api/status-pages/${beta}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          slug: `root-b-${stamp}`,
          published: false,
          title: "Root Beta",
          items: [],
        }),
      },
      owner,
    );
    expect(unpublished.status).toBe(200);
    expect((await api("/")).headers.get("location")).toBe("/login");
    const row = await env.DB.prepare(
      "SELECT serve_at_root AS root FROM status_pages WHERE id = ?",
    )
      .bind(beta)
      .first<{ root: number }>();
    expect(row?.root).toBe(0);
  });
});

async function createPage(
  cookie: string,
  slug: string,
  title: string,
  published = true,
): Promise<string> {
  const response = await api(
    "/api/status-pages",
    {
      method: "POST",
      body: JSON.stringify({
        slug,
        published,
        title,
        description: "",
        items: [],
      }),
    },
    cookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
