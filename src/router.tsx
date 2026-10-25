// SPDX-License-Identifier: MIT

import { safeReturnPath } from "@shared/front-door";
import { isSupportedLocale } from "@shared/locales";
import { QueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ApiClientError, api } from "./lib/api";
import {
  ForgotPage,
  InvitePage,
  LoginPage,
  ResetPage,
  SetupPage,
} from "./pages/auth";
import {
  AccountPage,
  AuditPage,
  ChannelsPage,
  NotFoundPage,
  SettingsPage,
  StatusPagesPage,
  TeamPage,
  TokensPage,
} from "./pages/manage";
import {
  DashboardPage,
  MonitorDetailPage,
  MonitorFormPage,
} from "./pages/monitors";
import { PublicStatusPage } from "./pages/public";
import { getLocale, setLocale } from "./paraglide/runtime.js";
import { type SessionUser, Shell } from "./shell";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 4_000 } },
});

type Meta = { setupRequired: boolean };

async function meta() {
  // fetchQuery honors invalidation. ensureQueryData in this Query version
  // returns the previous value even after a sign-in marks it stale.
  return queryClient.fetchQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/api/meta"),
  });
}

async function session() {
  return queryClient.fetchQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: SessionUser | null }>("/api/auth/session"),
  });
}

async function applyExplicitLocale(locale: string | null | undefined) {
  if (!locale || !isSupportedLocale(locale) || getLocale() === locale) return;
  await setLocale(locale);
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async () => {
    if (!(await meta()).setupRequired) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = typeof search.next === "string" ? search.next : undefined;
    return next ? { next } : {};
  },
  beforeLoad: async () => {
    if ((await meta()).setupRequired) throw redirect({ to: "/setup" });
    if ((await session()).user) throw redirect({ to: "/console" });
  },
  component: LoginPage,
});

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot",
  component: ForgotPage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset/$token",
  component: ResetPage,
});
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: InvitePage,
});
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$slug",
  beforeLoad: async () => {
    const lang = new URLSearchParams(window.location.search).get("lang");
    await applyExplicitLocale(lang);
  },
  component: PublicStatusPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
    const lang = new URLSearchParams(window.location.search).get("lang");
    await applyExplicitLocale(lang);
    try {
      await queryClient.fetchQuery({
        queryKey: ["public-root"],
        staleTime: 0,
        queryFn: () => api("/api/public/root"),
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404)
        throw redirect({ to: "/login" });
      throw error;
    }
  },
  component: PublicStatusPage,
});

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/console",
  beforeLoad: async ({ location }) => {
    if ((await meta()).setupRequired) throw redirect({ to: "/setup" });
    const current = await session();
    if (!current.user) {
      const next = safeReturnPath(`${location.pathname}${location.searchStr}`);
      throw redirect({
        to: "/login",
        search: next ? { next } : {},
      });
    }
    await applyExplicitLocale(current.user.locale);
    return { user: current.user };
  },
  component: function AppShell() {
    const { user } = consoleRoute.useRouteContext();
    return <Shell user={user} />;
  },
});

const indexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/",
  component: DashboardPage,
});
const newMonitorRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/monitors/new",
  component: MonitorFormPage,
});
const monitorRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/monitors/$id",
  component: MonitorDetailPage,
});
const pagesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/status-pages",
  component: StatusPagesPage,
});
const channelsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/channels",
  component: ChannelsPage,
});
const teamRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/team",
  component: TeamPage,
});
const tokensRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/tokens",
  component: TokensPage,
});
const auditRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/audit",
  component: AuditPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/settings",
  component: SettingsPage,
});
const accountRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/account",
  component: AccountPage,
});

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
  publicRoute,
  homeRoute,
  consoleRoute.addChildren([
    indexRoute,
    newMonitorRoute,
    monitorRoute,
    pagesRoute,
    channelsRoute,
    teamRoute,
    tokensRoute,
    auditRoute,
    settingsRoute,
    accountRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
