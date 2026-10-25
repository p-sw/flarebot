// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { api } from "./lib/api";
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

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async () => {
    if (!(await meta()).setupRequired) throw redirect({ to: "/" });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    if ((await meta()).setupRequired) throw redirect({ to: "/setup" });
    if ((await session()).user) throw redirect({ to: "/" });
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
  component: PublicStatusPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async () => {
    if ((await meta()).setupRequired) throw redirect({ to: "/setup" });
    const current = await session();
    if (!current.user) throw redirect({ to: "/login" });
    return { user: current.user };
  },
  component: function AppShell() {
    const { user } = appRoute.useRouteContext();
    return <Shell user={user} />;
  },
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardPage,
});
const newMonitorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/monitors/new",
  component: MonitorFormPage,
});
const monitorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/monitors/$id",
  component: MonitorDetailPage,
});
const pagesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/status-pages",
  component: StatusPagesPage,
});
const channelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/channels",
  component: ChannelsPage,
});
const teamRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/team",
  component: TeamPage,
});
const tokensRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tokens",
  component: TokensPage,
});
const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/audit",
  component: AuditPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
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
  appRoute.addChildren([
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
