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
  pushUrl?: string;
};

export type MonitorDetail = MonitorListItem & {
  config: Record<string, unknown>;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  recoveryThreshold: number;
  channelIds: string[];
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

export function statsQuery(id: string) {
  return queryOptions({
    queryKey: ["stats", id],
    queryFn: () =>
      api<{
        recent: { t: number; ok: boolean; ms: number }[];
        uptime: {
          h24: number | null;
          d7: number | null;
          d30: number | null;
          d90: number | null;
        };
        p95: number;
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
  defaultLocale: string;
  sourceLocale: string;
  locales: string[];
  i18n: Record<string, Record<string, string>>;
  logoUrl: string | null;
  accent: string | null;
  items: {
    id: string;
    monitorId: string;
    monitorName: string;
    position: number;
    groupName: string;
    displayName: string;
    sourceLocale: string;
    i18n: Record<string, Record<string, string>>;
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

export const channelsQuery = queryOptions({
  queryKey: ["channels"],
  queryFn: () =>
    api<{ channels: { id: string; name: string; type: string }[] }>(
      "/api/channels",
    ),
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
    api<{ instanceName: string; authMode: string }>("/api/settings"),
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

export const mailQuery = queryOptions({
  queryKey: ["mail"],
  queryFn: () => api<MailSettings>("/api/settings/mail"),
  staleTime: fresh,
});

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
