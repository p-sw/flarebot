// SPDX-License-Identifier: MIT

import {
  type MonitorType,
  monitorTypeSchema,
  monitorWriteSchema,
} from "./schemas";

export const monitorMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
export const dnsRecordTypes = ["A", "AAAA", "CNAME", "MX", "TXT"] as const;

export type MonitorMethod = (typeof monitorMethods)[number];
export type DnsRecordType = (typeof dnsRecordTypes)[number];

export type HeaderDraft = { id: string; name: string; value: string };

export type MonitorDraft = {
  name: string;
  type: MonitorType;
  intervalSeconds: string;
  timeoutSeconds: string;
  retries: string;
  recoveryThreshold: string;
  url: string;
  method: MonitorMethod;
  headers: HeaderDraft[];
  body: string;
  followRedirects: boolean;
  expectedStatuses: string;
  keyword: string;
  keywordMode: "present" | "absent";
  jsonPath: string;
  jsonExpect: string;
  host: string;
  port: string;
  dnsName: string;
  dnsType: DnsRecordType;
  expected: string;
  resolver: string;
  warnDays: string;
  graceSeconds: string;
  channelIds: string[];
  paused: boolean;
};

export type MonitorErrorCode =
  | "name"
  | "interval"
  | "timeout"
  | "retries"
  | "recovery"
  | "url"
  | "url_blocked"
  | "host"
  | "host_private"
  | "port"
  | "port_blocked"
  | "dns_name"
  | "dns_expected"
  | "resolver"
  | "warn"
  | "grace"
  | "headers"
  | "statuses"
  | "keyword"
  | "json"
  | "body"
  | "channels"
  | "generic";

const sensitiveHeader =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key)$/i;

export function isSensitiveHeader(name: string): boolean {
  return sensitiveHeader.test(name.trim());
}

export function maskHeaderValue(value: string): string {
  return value ? "••••••••" : "";
}

export function monitorTargetLabel(type: string, config: unknown): string {
  const value = record(config);
  switch (type) {
    case "http":
      return text(value.url);
    case "tcp": {
      const host = text(value.host);
      if (!host) return "";
      return `${host}:${text(value.port)}`;
    }
    case "dns":
      return [text(value.type), text(value.name)].filter(Boolean).join(" ");
    case "ssl":
      return text(value.host);
    default:
      return "";
  }
}

export function blankMonitorDraft(): MonitorDraft {
  return {
    name: "",
    type: "http",
    intervalSeconds: "60",
    timeoutSeconds: "10",
    retries: "2",
    recoveryThreshold: "1",
    url: "https://example.com",
    method: "GET",
    headers: [],
    body: "",
    followRedirects: true,
    expectedStatuses: "200",
    keyword: "",
    keywordMode: "present",
    jsonPath: "",
    jsonExpect: "",
    host: "1.1.1.1",
    port: "443",
    dnsName: "example.com",
    dnsType: "A",
    expected: "1.1.1.1",
    resolver: "",
    warnDays: "14",
    graceSeconds: "30",
    channelIds: [],
    paused: false,
  };
}

export function draftFromMonitor(monitor: {
  name: string;
  type: string;
  config: unknown;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  recoveryThreshold: number;
  channelIds: string[];
  paused: boolean;
}): MonitorDraft {
  const base = blankMonitorDraft();
  const config = record(monitor.config);
  const parsedType = monitorTypeSchema.safeParse(monitor.type);
  return {
    ...base,
    name: monitor.name,
    type: parsedType.success ? parsedType.data : "http",
    intervalSeconds: String(monitor.intervalSeconds),
    timeoutSeconds: String(monitor.timeoutSeconds),
    retries: String(monitor.retries),
    recoveryThreshold: String(monitor.recoveryThreshold),
    channelIds: [...monitor.channelIds],
    paused: monitor.paused,
    url: text(config.url) || base.url,
    method: isMethod(config.method) ? config.method : "GET",
    headers: headersFrom(config.headers),
    body: text(config.body),
    followRedirects: config.followRedirects !== false,
    expectedStatuses: Array.isArray(config.expectedStatuses)
      ? config.expectedStatuses.map((item) => String(item)).join(", ")
      : base.expectedStatuses,
    keyword: text(config.keyword),
    keywordMode: config.keywordMode === "absent" ? "absent" : "present",
    jsonPath: text(config.jsonPath),
    jsonExpect: text(config.jsonExpect),
    host: text(config.host) || base.host,
    port: config.port == null ? base.port : String(config.port),
    dnsName: text(config.name) || base.dnsName,
    dnsType: isDnsType(config.type) ? config.type : "A",
    expected: Array.isArray(config.expected)
      ? config.expected.map((item) => String(item)).join(", ")
      : base.expected,
    resolver: text(config.resolver),
    warnDays: config.warnDays == null ? base.warnDays : String(config.warnDays),
    graceSeconds:
      config.graceSeconds == null
        ? base.graceSeconds
        : String(config.graceSeconds),
  };
}

export function monitorPayload(draft: MonitorDraft) {
  return {
    name: draft.name.trim(),
    type: draft.type,
    config: configFromDraft(draft),
    intervalSeconds: integer(draft.intervalSeconds),
    timeoutSeconds: integer(draft.timeoutSeconds),
    retries: integer(draft.retries),
    recoveryThreshold: integer(draft.recoveryThreshold),
    channelIds: draft.channelIds,
    paused: draft.paused,
  };
}

export function monitorFieldErrors(
  draft: MonitorDraft,
): Partial<Record<keyof MonitorDraft, MonitorErrorCode>> {
  const parsed = monitorWriteSchema.safeParse(monitorPayload(draft));
  if (parsed.success) return {};
  const errors: Partial<Record<keyof MonitorDraft, MonitorErrorCode>> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join(".");
    const field = fieldFor(draft, path);
    if (!errors[field]) errors[field] = codeFor(field, issue.message);
  }
  return errors;
}

function configFromDraft(draft: MonitorDraft): unknown {
  switch (draft.type) {
    case "http": {
      const config: Record<string, unknown> = {
        url: draft.url.trim(),
        method: draft.method,
        headers: draft.headers
          .filter((header) => header.name.trim() || header.value)
          .map((header) => ({
            name: header.name.trim(),
            value: header.value,
          })),
        followRedirects: draft.followRedirects,
        expectedStatuses: split(draft.expectedStatuses).map((item) =>
          Number(item),
        ),
        keywordMode: draft.keywordMode,
      };
      if (draft.body) config.body = draft.body;
      if (draft.keyword.trim()) config.keyword = draft.keyword.trim();
      if (draft.jsonPath.trim()) config.jsonPath = draft.jsonPath.trim();
      if (draft.jsonExpect.trim()) config.jsonExpect = draft.jsonExpect.trim();
      return config;
    }
    case "tcp":
      return { host: draft.host.trim(), port: integer(draft.port) };
    case "dns": {
      const config: Record<string, unknown> = {
        name: draft.dnsName.trim(),
        type: draft.dnsType,
        expected: split(draft.expected),
      };
      if (draft.resolver.trim()) config.resolver = draft.resolver.trim();
      return config;
    }
    case "ssl":
      return { host: draft.host.trim(), warnDays: integer(draft.warnDays) };
    case "heartbeat":
      return { graceSeconds: integer(draft.graceSeconds) };
  }
}

function fieldFor(draft: MonitorDraft, path: string): keyof MonitorDraft {
  if (path === "config.name") return draft.type === "dns" ? "dnsName" : "host";
  if (path === "config.type") return "dnsType";
  if (path.startsWith("config.headers")) return "headers";
  if (path.startsWith("config.expectedStatuses")) return "expectedStatuses";
  if (path.startsWith("channelIds")) return "channelIds";
  const known: Record<string, keyof MonitorDraft> = {
    name: "name",
    intervalSeconds: "intervalSeconds",
    timeoutSeconds: "timeoutSeconds",
    retries: "retries",
    recoveryThreshold: "recoveryThreshold",
    "config.url": "url",
    "config.method": "method",
    "config.body": "body",
    "config.keyword": "keyword",
    "config.jsonPath": "jsonPath",
    "config.jsonExpect": "jsonExpect",
    "config.host": "host",
    "config.port": "port",
    "config.expected": "expected",
    "config.resolver": "resolver",
    "config.warnDays": "warnDays",
    "config.graceSeconds": "graceSeconds",
  };
  return known[path] ?? "name";
}

function codeFor(field: keyof MonitorDraft, message: string): MonitorErrorCode {
  if (message.includes("Port 25")) return "port_blocked";
  if (
    message.includes("Private") ||
    message.includes("not allowed") ||
    message.includes("local")
  ) {
    return field === "url" ? "url_blocked" : "host_private";
  }
  switch (field) {
    case "name":
      return "name";
    case "intervalSeconds":
      return "interval";
    case "timeoutSeconds":
      return "timeout";
    case "retries":
      return "retries";
    case "recoveryThreshold":
      return "recovery";
    case "url":
      return "url";
    case "host":
      return "host";
    case "port":
      return "port";
    case "dnsName":
      return "dns_name";
    case "expected":
      return "dns_expected";
    case "resolver":
      return "resolver";
    case "warnDays":
      return "warn";
    case "graceSeconds":
      return "grace";
    case "headers":
      return "headers";
    case "expectedStatuses":
      return "statuses";
    case "keyword":
      return "keyword";
    case "jsonPath":
    case "jsonExpect":
      return "json";
    case "body":
      return "body";
    case "channelIds":
      return "channels";
    default:
      return "generic";
  }
}

function record(config: unknown): Record<string, unknown> {
  return config && typeof config === "object"
    ? (config as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function integer(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function split(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function headersFrom(value: unknown): HeaderDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((header) => {
    if (!header || typeof header !== "object") return [];
    const row = header as Record<string, unknown>;
    return [
      {
        id: crypto.randomUUID(),
        name: text(row.name),
        value: text(row.value),
      },
    ];
  });
}

function isMethod(value: unknown): value is MonitorMethod {
  return monitorMethods.includes(value as MonitorMethod);
}

function isDnsType(value: unknown): value is DnsRecordType {
  return dnsRecordTypes.includes(value as DnsRecordType);
}
