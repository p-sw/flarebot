// SPDX-License-Identifier: MIT

import { safeReturnPath } from "@shared/front-door";
import { can } from "@shared/permissions";
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
  accountQuery,
  auditQuery,
  channelsQuery,
  incidentQuery,
  incidentsQuery,
  mailQuery,
  maintenanceListQuery,
  maintenanceQuery,
  monitorQuery,
  monitorsQuery,
  outagesQuery,
  settingsQuery,
  ssoQuery,
  statsQuery,
  statusPageQuery,
  statusPagesQuery,
  teamQuery,
  tokensQuery,
} from "./lib/queries";
import { loadQuery } from "./lib/query-sync";
import {
  canReuseSession,
  sessionCacheEpoch,
  sessionCacheKey,
} from "./lib/session-gate";
import {
  ForgotPage,
  InvitePage,
  LoginPage,
  ResetPage,
  SetupPage,
} from "./pages/auth";
import { ChannelsPage } from "./pages/channels";
import { IncidentCreatePage, IncidentEditPage } from "./pages/incident-form";
import { PublicIncidentPage } from "./pages/incident-public";
import { IncidentsPage } from "./pages/incidents";
import { MaintenancePage } from "./pages/maintenance";
import {
  MaintenanceCreatePage,
  MaintenanceEditPage,
} from "./pages/maintenance-form";
import {
  AccountPage,
  AuditPage,
  NotFoundPage,
  SettingsPage,
  StatusPagesPage,
  TeamPage,
  TokensPage,
} from "./pages/manage";
import { MonitorEditPage, MonitorFormPage } from "./pages/monitor-form";
import { DashboardPage, MonitorDetailPage } from "./pages/monitors";
import { PublicStatusPage } from "./pages/public";
import {
  StatusPageCreatePage,
  StatusPageEditPage,
} from "./pages/status-page-form";
import { SubscribeManagePage } from "./pages/subscribe-manage";
import { type SessionUser, Shell } from "./shell";
import { ContentSkeleton } from "./ui/skeleton";

const SESSION_STALE = 60_000;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});

type Meta = { setupRequired: boolean };

async function meta() {
  // fetchQuery honors invalidation. ensureQueryData in this Query version
  // returns the previous value even after a sign-in marks it stale.
  return queryClient.fetchQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/api/meta"),
    staleTime: SESSION_STALE,
  });
}

function sessionOptions() {
  const epoch = sessionCacheEpoch();
  return {
    queryKey: sessionCacheKey(),
    queryFn: async () => {
      const result = await api<{ user: SessionUser | null }>(
        "/api/auth/session",
      );
      if (epoch !== sessionCacheEpoch()) {
        throw new Error("session superseded");
      }
      return result;
    },
    staleTime: SESSION_STALE,
  };
}

async function session() {
  return queryClient.fetchQuery(sessionOptions());
}

function cachedUser() {
  return (
    queryClient.getQueryData<{ user: SessionUser | null }>(sessionCacheKey())
      ?.user ?? null
  );
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
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; "break-glass"?: 1; sso_error?: string } => {
    const next = typeof search.next === "string" ? search.next : undefined;
    const breakGlass =
      search["break-glass"] === 1 || search["break-glass"] === "1"
        ? 1
        : undefined;
    const allowed = new Set([
      "denied",
      "email",
      "domain",
      "state",
      "token",
      "config",
      "disabled",
      "link",
      "jit",
      "role",
    ]);
    const raw = typeof search.sso_error === "string" ? search.sso_error : "";
    const ssoError = allowed.has(raw) ? raw : undefined;
    return {
      ...(next ? { next } : {}),
      ...(breakGlass ? { "break-glass": 1 as const } : {}),
      ...(ssoError ? { sso_error: ssoError } : {}),
    };
  },
  beforeLoad: async () => {
    const [info, current] = await Promise.all([meta(), session()]);
    if (info.setupRequired) throw redirect({ to: "/setup" });
    if (current.user) throw redirect({ to: "/console" });
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
const publicIncidentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$slug/incidents/$incidentId",
  component: PublicIncidentPage,
});

const manageSubscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/subscribe/manage/$token",
  component: SubscribeManagePage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async () => {
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
  beforeLoad: async ({ cause, location, navigate }) => {
    // This parent gate runs on every child navigation. Waiting on the network
    // here is what froze the shell for about a second after each click.
    const epoch = sessionCacheEpoch();
    const user = cachedUser();
    if (user && canReuseSession(cause, user)) {
      const updatedAt =
        queryClient.getQueryState(sessionCacheKey())?.dataUpdatedAt ?? 0;
      if (cause === "stay" && Date.now() - updatedAt > SESSION_STALE) {
        void session()
          .then((next) => {
            if (epoch !== sessionCacheEpoch() || next.user) return;
            const nextPath = safeReturnPath(
              `${location.pathname}${location.searchStr}`,
            );
            void navigate({
              to: "/login",
              search: nextPath ? { next: nextPath } : {},
            });
          })
          .catch(() => undefined);
      }
      return { user };
    }
    const [info, current] = await Promise.all([meta(), session()]);
    if (info.setupRequired) throw redirect({ to: "/setup" });
    if (!current.user) {
      const next = safeReturnPath(`${location.pathname}${location.searchStr}`);
      throw redirect({
        to: "/login",
        search: next ? { next } : {},
      });
    }
    return { user: current.user };
  },
  component: function AppShell() {
    const { user } = consoleRoute.useRouteContext();
    return <Shell user={user} />;
  },
});

const pending = {
  pendingComponent: ContentSkeleton,
  pendingMs: 120,
  pendingMinMs: 0,
};

const indexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/",
  loader: () => loadQuery(queryClient, monitorsQuery).catch(() => undefined),
  ...pending,
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
  validateSearch: (search: Record<string, unknown>): { saved?: 1 } =>
    search.saved === 1 || search.saved === "1" ? { saved: 1 } : {},
  loader: ({ params }) =>
    Promise.all([
      loadQuery(queryClient, monitorQuery(params.id)),
      loadQuery(queryClient, statsQuery(params.id)),
      loadQuery(queryClient, outagesQuery(params.id)),
    ]).catch(() => undefined),
  ...pending,
  component: MonitorDetailPage,
});
const editMonitorRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/monitors/$id/edit",
  loader: ({ params }) =>
    Promise.all([
      loadQuery(queryClient, monitorQuery(params.id)),
      loadQuery(queryClient, channelsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: MonitorEditPage,
});
const incidentsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/incidents",
  loader: () =>
    loadQuery(queryClient, incidentsQuery("active")).catch(() => undefined),
  ...pending,
  component: IncidentsPage,
});
const newIncidentRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/incidents/new",
  loader: () =>
    Promise.all([
      loadQuery(queryClient, monitorsQuery),
      loadQuery(queryClient, statusPagesQuery),
      loadQuery(queryClient, channelsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: IncidentCreatePage,
});
const editIncidentRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/incidents/$id",
  loader: ({ params }) =>
    Promise.all([
      loadQuery(queryClient, incidentQuery(params.id)),
      loadQuery(queryClient, monitorsQuery),
      loadQuery(queryClient, statusPagesQuery),
      loadQuery(queryClient, channelsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: IncidentEditPage,
});
const maintenanceRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/maintenance",
  loader: () =>
    loadQuery(queryClient, maintenanceListQuery("upcoming")).catch(
      () => undefined,
    ),
  ...pending,
  component: MaintenancePage,
});
const newMaintenanceRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/maintenance/new",
  loader: () =>
    Promise.all([
      loadQuery(queryClient, monitorsQuery),
      loadQuery(queryClient, statusPagesQuery),
      loadQuery(queryClient, channelsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: MaintenanceCreatePage,
});
const editMaintenanceRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/maintenance/$id",
  loader: ({ params }) =>
    Promise.all([
      loadQuery(queryClient, maintenanceQuery(params.id)),
      loadQuery(queryClient, monitorsQuery),
      loadQuery(queryClient, statusPagesQuery),
      loadQuery(queryClient, channelsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: MaintenanceEditPage,
});
const pagesRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/status-pages",
  loader: () => loadQuery(queryClient, statusPagesQuery).catch(() => undefined),
  ...pending,
  component: StatusPagesPage,
});
const newPageRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/status-pages/new",
  loader: () => loadQuery(queryClient, monitorsQuery).catch(() => undefined),
  ...pending,
  component: StatusPageCreatePage,
});
const editPageRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/status-pages/$id",
  validateSearch: (search: Record<string, unknown>): { created?: 1 } =>
    search.created === 1 || search.created === "1" ? { created: 1 } : {},
  loader: ({ params }) =>
    Promise.all([
      loadQuery(queryClient, statusPageQuery(params.id)),
      loadQuery(queryClient, monitorsQuery),
    ]).catch(() => undefined),
  ...pending,
  component: StatusPageEditPage,
});
const channelsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/channels",
  loader: () => loadQuery(queryClient, channelsQuery).catch(() => undefined),
  ...pending,
  component: ChannelsPage,
});
const teamRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/team",
  loader: () => loadQuery(queryClient, teamQuery).catch(() => undefined),
  ...pending,
  component: TeamPage,
});
const tokensRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/tokens",
  loader: () => loadQuery(queryClient, tokensQuery).catch(() => undefined),
  ...pending,
  component: TokensPage,
});
const auditRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/audit",
  loader: () => loadQuery(queryClient, auditQuery).catch(() => undefined),
  ...pending,
  component: AuditPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/settings",
  loader: () => {
    const user = queryClient.getQueryData<{ user: SessionUser | null }>(
      sessionCacheKey(),
    )?.user;
    const tasks: Promise<unknown>[] = [];
    if (user && can({ role: user.role }, "instance.settings")) {
      tasks.push(loadQuery(queryClient, settingsQuery).catch(() => undefined));
      tasks.push(loadQuery(queryClient, mailQuery).catch(() => undefined));
    }
    if (user && can({ role: user.role }, "sso.manage")) {
      tasks.push(loadQuery(queryClient, ssoQuery).catch(() => undefined));
    }
    return Promise.all(tasks);
  },
  ...pending,
  component: SettingsPage,
});
const accountRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/account",
  loader: () => loadQuery(queryClient, accountQuery).catch(() => undefined),
  ...pending,
  component: AccountPage,
});

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
  publicIncidentRoute,
  publicRoute,
  manageSubscribeRoute,
  homeRoute,
  consoleRoute.addChildren([
    indexRoute,
    newMonitorRoute,
    editMonitorRoute,
    monitorRoute,
    incidentsRoute,
    newIncidentRoute,
    editIncidentRoute,
    maintenanceRoute,
    newMaintenanceRoute,
    editMaintenanceRoute,
    pagesRoute,
    newPageRoute,
    editPageRoute,
    channelsRoute,
    teamRoute,
    tokensRoute,
    auditRoute,
    settingsRoute,
    accountRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadDelay: 40,
  defaultPendingMs: 120,
  defaultPendingMinMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
