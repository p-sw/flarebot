// SPDX-License-Identifier: MIT

import type { Hono } from "hono";
import { decideFrontDoor, normalizePathname } from "../shared/front-door";
import { getDb } from "./db/client";
import { users } from "./db/schema";
import { type AppContext, type AppEnv, loadActor } from "./http";
import {
  loadPublicStatus,
  loadRootPublicStatus,
  publishedPageExists,
  statusDocument,
} from "./status/public";

const LEGACY_ROOTS = [
  "monitors",
  "status-pages",
  "channels",
  "team",
  "tokens",
  "audit",
  "settings",
  "account",
] as const;

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "private, no-store",
    },
  });
}

function headSafe(c: AppContext, response: Response): Response {
  if (c.req.method !== "HEAD") return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function spa(c: AppContext): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(c.req.method === "HEAD" ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

async function setupRequired(env: Env): Promise<boolean> {
  const owner = await getDb(env.DB)
    .select({ id: users.id })
    .from(users)
    .limit(1)
    .get();
  return !owner;
}

async function applyDecision(
  c: AppContext,
  decision: ReturnType<typeof decideFrontDoor>,
  page?: Awaited<ReturnType<typeof loadRootPublicStatus>>,
): Promise<Response> {
  if (decision.type === "redirect") return redirect(decision.location);
  if (decision.type === "public-root") {
    if (!page) return redirect("/login");
    return headSafe(c, await statusDocument(c.env, c.req.raw, page));
  }
  if (decision.type === "spa") return spa(c);
  return c.notFound();
}

export function registerFrontDoor(app: Hono<AppEnv>): void {
  app.on(["GET", "HEAD"], "/s/:slug/incidents/:incidentId", async (c) => {
    const exists = await publishedPageExists(c.env, c.req.param("slug"));
    if (!exists) return c.notFound();
    return spa(c);
  });

  app.on(["GET", "HEAD"], "/s/:slug", async (c) => {
    const page = await loadPublicStatus(c.env, c.req.param("slug"));
    if (!page) return c.notFound();
    return headSafe(c, await statusDocument(c.env, c.req.raw, page));
  });

  app.on(["GET", "HEAD"], "/", async (c) => {
    const url = new URL(c.req.url);
    const page = await loadRootPublicStatus(c.env);
    return applyDecision(
      c,
      decideFrontDoor({
        pathname: url.pathname,
        search: url.search,
        setupRequired: false,
        authenticated: false,
        rootAvailable: Boolean(page),
      }),
      page,
    );
  });

  const handleLogin = async (c: AppContext) => {
    const url = new URL(c.req.url);
    const needsSetup = await setupRequired(c.env);
    const authenticated = needsSetup ? false : Boolean(await loadActor(c));
    return applyDecision(
      c,
      decideFrontDoor({
        pathname: url.pathname,
        search: url.search,
        setupRequired: needsSetup,
        authenticated,
        rootAvailable: false,
      }),
    );
  };
  app.on(["GET", "HEAD"], "/login", handleLogin);
  app.on(["GET", "HEAD"], "/login/", handleLogin);

  const handleSetup = async (c: AppContext) => {
    const url = new URL(c.req.url);
    return applyDecision(
      c,
      decideFrontDoor({
        pathname: url.pathname,
        search: url.search,
        setupRequired: await setupRequired(c.env),
        authenticated: false,
        rootAvailable: false,
      }),
    );
  };
  app.on(["GET", "HEAD"], "/setup", handleSetup);
  app.on(["GET", "HEAD"], "/setup/", handleSetup);

  const handleConsole = async (c: AppContext) => {
    const url = new URL(c.req.url);
    const needsSetup = await setupRequired(c.env);
    const authenticated = needsSetup ? false : Boolean(await loadActor(c));
    return applyDecision(
      c,
      decideFrontDoor({
        pathname: normalizePathname(url.pathname),
        search: url.search,
        setupRequired: needsSetup,
        authenticated,
        rootAvailable: false,
      }),
    );
  };
  app.on(["GET", "HEAD"], "/console", handleConsole);
  app.on(["GET", "HEAD"], "/console/*", handleConsole);

  const handleLegacy = (c: AppContext) => {
    const url = new URL(c.req.url);
    return applyDecision(
      c,
      decideFrontDoor({
        pathname: url.pathname,
        search: url.search,
        setupRequired: false,
        authenticated: false,
        rootAvailable: false,
      }),
    );
  };
  for (const name of LEGACY_ROOTS) {
    app.on(["GET", "HEAD"], `/${name}`, handleLegacy);
    app.on(["GET", "HEAD"], `/${name}/*`, handleLegacy);
  }
}
