// SPDX-License-Identifier: MIT

import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

const fresh = 30_000;

export type MonitorListItem = {
  id: string;
  name: string;
  type: string;
  status: string;
  uptime24: number | null;
  lastResponseMs: number | null;
  lastError: string | null;
  paused: boolean;
  intervalSeconds: number;
  target: string;
  pushUrl?: string;
};

export type MonitorStatusPageRef = {
  id: string;
  title: string;
  slug: string;
  published: boolean;
  serveAtRoot: boolean;
};

export type MonitorDetail = MonitorListItem & {
  config: Record<string, unknown>;
  timeoutSeconds: number;
  retries: number;
  recoveryThreshold: number;
  channelIds: string[];
  regions: string[];
  since: number | null;
  lastCheckAt: number | null;
  createdAt: number;
  updatedAt: number;
  statusPages: MonitorStatusPageRef[];
  badgesEnabled: boolean;
  badgesPublic: boolean;
};

export const monitorsQuery = queryOptions({
  queryKey: ["monitors"],
  queryFn: () => api<{ monitors: MonitorListItem[] }>("/api/monitors"),
  staleTime: fresh,
});

export function monitorQuery(id: string) {
  return queryOptions({
    queryKey: ["monitor", id],
    queryFn: () => api<MonitorDetail>(`/api/monitors/${id}`),
    staleTime: fresh,
  });
}

export type MonitorSpark = {
  currentMs: number | null;
  averageMs: number | null;
  uptime: number | null;
  points: { t: number; ms: number }[];
};

export function sparkQuery(id: string) {
  return queryOptions({
    queryKey: ["spark", id],
    queryFn: () => api<MonitorSpark>(`/api/monitors/${id}/spark`),
    staleTime: fresh,
  });
}

export function statsQuery(id: string) {
  return queryOptions({
    queryKey: ["stats", id],
    queryFn: () =>
      api<{
        recent: { t: number; ok: boolean; ms: number; maint?: boolean }[];
        uptime: {
          h24: number | null;
          d7: number | null;
          d30: number | null;
          d90: number | null;
        };
        p95: number;
        retentionDays: number;
      }>(`/api/monitors/${id}/stats`),
    staleTime: fresh,
  });
}

export function outagesQuery(id: string) {
  return queryOptions({
    queryKey: ["outages", id],
    queryFn: () =>
      api<{
        outages: {
          id: string;
          startedAt: number;
          endedAt: number | null;
          cause: string | null;
          acknowledgedAt: number | null;
        }[];
      }>(`/api/monitors/${id}/outages`),
    staleTime: fresh,
  });
}

export type StatusPageDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  footer: string;
  banner: string;
  published: boolean;
  serveAtRoot: boolean;
  logoUrl: string | null;
  accent: string | null;
  displayRange: "24h" | "7d" | "30d" | "90d";
  items: {
    id: string;
    monitorId: string;
    monitorName: string;
    position: number;
    groupName: string;
    displayName: string;
  }[];
};

export function statusPageQuery(id: string) {
  return queryOptions({
    queryKey: ["status-page", id],
    queryFn: () => api<StatusPageDetail>(`/api/status-pages/${id}`),
    staleTime: fresh,
  });
}

export const statusPagesQuery = queryOptions({
  queryKey: ["pages"],
  queryFn: () =>
    api<{
      pages: {
        id: string;
        slug: string;
        title: string;
        published: boolean;
        serveAtRoot: boolean;
        missing: number;
        itemCount: number;
      }[];
    }>("/api/status-pages"),
  staleTime: fresh,
});

export type ChannelRecord = {
  id: string;
  name: string;
  type: string;
  destination?: string;
  config?: Record<string, unknown>;
  secrets?: string[];
};

export const channelsQuery = queryOptions({
  queryKey: ["channels"],
  queryFn: () => api<{ channels: ChannelRecord[] }>("/api/channels"),
  staleTime: fresh,
});

export const teamQuery = queryOptions({
  queryKey: ["team"],
  queryFn: () =>
    api<{
      members: { id: string; name: string; email: string; role: string }[];
    }>("/api/team"),
  staleTime: fresh,
});

export const tokensQuery = queryOptions({
  queryKey: ["tokens"],
  queryFn: () =>
    api<{
      tokens: {
        id: string;
        name: string;
        scopes: string[];
        lastUsedAt: number | null;
      }[];
      allowedScopes: string[];
    }>("/api/tokens"),
  staleTime: fresh,
});

export const auditQuery = queryOptions({
  queryKey: ["audit"],
  queryFn: () =>
    api<{
      events: {
        id: string;
        action: string;
        target: string | null;
        createdAt: number;
      }[];
    }>("/api/audit"),
  staleTime: fresh,
});

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () =>
    api<{
      instanceName: string;
      authMode: string;
      historyRetentionDays: number;
    }>("/api/settings"),
  staleTime: fresh,
});

export type MailSettings = {
  driver: string;
  host: string;
  port: number;
  security: string;
  username: string;
  hasPassword: boolean;
  fromName: string;
  fromAddress: string;
  activeSource: "secrets" | "database" | "cloudflare" | "none";
  emailBinding: boolean;
  secretsOverride: boolean;
  lastTestOk: boolean | null;
  lastTestAt: number | null;
  lastTestError: string | null;
};

export const ssoQuery = queryOptions({
  queryKey: ["sso"],
  queryFn: () => api<SsoSettingsResponse>("/api/sso"),
  staleTime: fresh,
});

export type SsoRole = "owner" | "admin" | "editor" | "viewer";

export type SsoProviderView = {
  id: string;
  enabled: boolean;
  displayName: string;
  buttonLabel: string;
  issuerUrl: string;
  clientId: string;
  clientSecretSet: boolean;
  scopes: string;
  groupsClaim: string;
  jitEnabled: boolean;
  jitRole: SsoRole;
  allowedDomains: string[];
  roleMappings: { value: string; role: SsoRole }[];
  discoveryAt: number | null;
};

export type SsoAccessView = {
  enabled: boolean;
  teamName: string;
  audiences: string[];
  groupsClaim: string;
  jitEnabled: boolean;
  allowedDomains: string[];
  rules: {
    kind: "group" | "email" | "domain";
    value: string;
    role: SsoRole;
  }[];
};

export type SsoSettingsResponse = {
  redirectUri: string;
  hideLocalLogin: boolean;
  access: SsoAccessView;
  providers: SsoProviderView[];
};

export const mailQuery = queryOptions({
  queryKey: ["mail"],
  queryFn: () => api<MailSettings>("/api/settings/mail"),
  staleTime: fresh,
});

export type IncidentSummary = {
  id: string;
  title: string;
  status: string;
  resolvedAt: number | null;
  updatedAt: number;
  message: string;
};

export type IncidentUpdate = {
  id: string;
  status: string;
  body: string;
  postedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type IncidentDetail = {
  id: string;
  title: string;
  notify: boolean;
  resolvedAt: number | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  sourceOutageId: string | null;
  monitors: { monitorId: string; name: string; impact: string }[];
  pages: { pageId: string; title: string; slug: string }[];
  channels: { channelId: string; name: string }[];
  updates: IncidentUpdate[];
};

export function incidentsQuery(state: "active" | "resolved") {
  return queryOptions({
    queryKey: ["incidents", state],
    queryFn: () =>
      api<{ incidents: IncidentSummary[] }>(`/api/incidents?state=${state}`),
    staleTime: fresh,
  });
}

export function incidentQuery(id: string) {
  return queryOptions({
    queryKey: ["incident", id],
    queryFn: () => api<IncidentDetail>(`/api/incidents/${id}`),
    staleTime: fresh,
  });
}

export type MaintenanceSummary = {
  id: string;
  title: string;
  description: string;
  timezone: string;
  startAt: number;
  endAt: number;
  recurrence: string;
  notify: boolean;
  cancelledAt: number | null;
  state: "active" | "upcoming" | "past";
  next: { start: number; end: number } | null;
};

export type MaintenanceDetail = MaintenanceSummary & {
  weekdays: number[];
  createdAt: number;
  updatedAt: number;
  monitorIds: string[];
  pageIds: string[];
  channelIds: string[];
  monitors: { id: string; name: string }[];
  pages: { id: string; title: string; slug: string }[];
};

export function maintenanceListQuery(view: "upcoming" | "active" | "past") {
  return queryOptions({
    queryKey: ["maintenance", view],
    queryFn: () =>
      api<{ windows: MaintenanceSummary[] }>(`/api/maintenance?view=${view}`),
    staleTime: fresh,
  });
}

export function maintenanceQuery(id: string) {
  return queryOptions({
    queryKey: ["maintenance-window", id],
    queryFn: () => api<MaintenanceDetail>(`/api/maintenance/${id}`),
    staleTime: fresh,
  });
}

export const accountQuery = queryOptions({
  queryKey: ["account"],
  queryFn: () =>
    api<{
      name: string;
      email: string;
      totpEnabled: boolean;
      passkeys: { id: string; deviceName: string | null }[];
    }>("/api/account"),
  staleTime: fresh,
});
