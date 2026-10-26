// SPDX-License-Identifier: MIT

import { z } from "zod";
import { isBlockedHost } from "./schemas";

export const channelTypeSchema = z.enum([
  "email",
  "discord",
  "slack",
  "telegram",
  "webhook",
  "ntfy",
  "gotify",
  "pushover",
  "teams",
  "google_chat",
  "matrix",
]);

export type ChannelType = z.infer<typeof channelTypeSchema>;

export const channelTypes = channelTypeSchema.options;

export function isChannelType(value: string): value is ChannelType {
  return channelTypeSchema.safeParse(value).success;
}

// Fields the API must blank before a browser sees the config. The whole JSON
// is encrypted at rest; this list is what the console is allowed to echo.
export const channelSecretFields: Record<ChannelType, readonly string[]> = {
  email: [],
  discord: ["webhookUrl"],
  slack: ["webhookUrl"],
  telegram: ["botToken"],
  webhook: ["url", "headers"],
  ntfy: ["token"],
  gotify: ["token"],
  pushover: ["userKey", "appToken"],
  teams: ["webhookUrl"],
  google_chat: ["webhookUrl"],
  matrix: ["accessToken"],
};

const optionalSecret = z.string().trim().max(2000, "invalid").optional();

const requiredSecret = z
  .string()
  .trim()
  .min(1, "required")
  .max(2000, "invalid");

export function publicUrlProblem(value: string): "invalid" | "blocked" | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid";
  if (!url.hostname) return "invalid";
  if (isBlockedHost(url.hostname)) return "blocked";
  return null;
}

function publicHttpUrl() {
  return z
    .string()
    .trim()
    .min(1, "required")
    .max(4000, "invalid")
    .superRefine((value, ctx) => {
      const problem = publicUrlProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
}

function optionalInt(min: number, max: number) {
  return z
    .number({ invalid_type_error: "invalid" })
    .int("invalid")
    .min(min, "invalid")
    .max(max, "invalid")
    .optional();
}

const tagPattern = /^[A-Za-z0-9_+-]{1,40}$/;
const devicePattern = /^[A-Za-z0-9_-]+(\s*,\s*[A-Za-z0-9_-]+)*$/;
const soundPattern = /^[A-Za-z0-9_-]+$/;
const roomPattern = /^(!|#)[^:\s]{1,200}:[A-Za-z0-9.-]{1,255}$/;

const optionalTags = z
  .string()
  .trim()
  .max(200, "invalid")
  .refine((value) => {
    if (!value) return true;
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return (
      parts.length > 0 &&
      parts.length <= 8 &&
      parts.every((part) => tagPattern.test(part))
    );
  }, "invalid")
  .optional();

const optionalDevice = z
  .string()
  .trim()
  .max(200, "invalid")
  .refine((value) => !value || devicePattern.test(value), "invalid")
  .optional();

const optionalSound = z
  .string()
  .trim()
  .max(40, "invalid")
  .refine((value) => !value || soundPattern.test(value), "invalid")
  .optional();

const headerSchema = z.object({
  name: z.string().trim().min(1, "required").max(80, "invalid"),
  value: z.string().max(500, "invalid"),
});

function configSchema(type: ChannelType): z.ZodTypeAny {
  switch (type) {
    case "email":
      return z.object({
        to: z.string().trim().min(1, "required").email("invalid"),
      });
    case "discord":
    case "slack":
    case "teams":
    case "google_chat":
      return z.object({ webhookUrl: publicHttpUrl() });
    case "telegram":
      return z.object({
        botToken: z.string().trim().min(10, "required").max(200, "invalid"),
        chatId: z.string().trim().min(1, "required").max(64, "invalid"),
      });
    case "webhook":
      return z.object({
        url: publicHttpUrl(),
        headers: z.array(headerSchema).max(10, "invalid").optional(),
      });
    case "ntfy":
      return z.object({
        server: publicHttpUrl(),
        topic: z
          .string()
          .trim()
          .min(1, "required")
          .regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid"),
        token: optionalSecret,
        priority: optionalInt(1, 5),
        tags: optionalTags,
      });
    case "gotify":
      return z.object({
        server: publicHttpUrl(),
        token: requiredSecret,
        priority: optionalInt(0, 10),
      });
    case "pushover":
      return z.object({
        userKey: z
          .string()
          .trim()
          .min(1, "required")
          .regex(/^[A-Za-z0-9]{20,50}$/, "invalid"),
        appToken: z
          .string()
          .trim()
          .min(1, "required")
          .regex(/^[A-Za-z0-9]{20,50}$/, "invalid"),
        device: optionalDevice,
        priority: optionalInt(-2, 2),
        sound: optionalSound,
      });
    case "matrix":
      return z.object({
        homeserver: publicHttpUrl(),
        accessToken: z.string().trim().min(10, "required").max(2000, "invalid"),
        roomId: z
          .string()
          .trim()
          .min(1, "required")
          .max(255, "invalid")
          .regex(roomPattern, "invalid"),
      });
  }
}

export const channelWriteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: channelTypeSchema,
  config: z.unknown(),
  clearSecrets: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});

export function parseChannelConfig(type: ChannelType, config: unknown) {
  return configSchema(type).safeParse(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretMask(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^[•*]+$/.test(trimmed);
}

function compactConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }
  return next;
}

export function mergeChannelSecrets(
  type: ChannelType,
  incoming: unknown,
  stored: Record<string, unknown> | null,
  clearSecrets: readonly string[] = [],
): unknown {
  if (!stored || !isRecord(incoming)) return incoming;
  const next: Record<string, unknown> = { ...incoming };
  const clearing = new Set(clearSecrets);
  for (const field of channelSecretFields[type]) {
    if (field === "headers") continue;
    if (clearing.has(field)) {
      next[field] = "";
      continue;
    }
    const value = next[field];
    if (
      (typeof value !== "string" ||
        value.trim() === "" ||
        isSecretMask(value)) &&
      typeof stored[field] === "string"
    ) {
      next[field] = stored[field];
    }
  }
  const storedHeaders = stored.headers;
  if (
    type === "webhook" &&
    !clearing.has("headers") &&
    Array.isArray(next.headers) &&
    Array.isArray(storedHeaders)
  ) {
    next.headers = next.headers.map((header, index) => {
      if (!isRecord(header)) return header;
      const previous = storedHeaders[index];
      if (!isRecord(previous)) return header;
      const value = header.value;
      const blank =
        typeof value !== "string" || value.trim() === "" || isSecretMask(value);
      if (
        blank &&
        header.name === previous.name &&
        typeof previous.value === "string"
      ) {
        return { ...header, value: previous.value };
      }
      return header;
    });
  }
  return next;
}

export function resolveChannelConfig(
  type: ChannelType,
  config: unknown,
  stored: Record<string, unknown> | null,
  clearSecrets: readonly string[] = [],
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: { path: string; message: string }[] } {
  const parsed = parseChannelConfig(
    type,
    mergeChannelSecrets(type, config, stored, clearSecrets),
  );
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }
  const data = parsed.data as Record<string, unknown>;
  return { ok: true, config: compactConfig(data) };
}

export function redactChannelConfig(
  type: ChannelType,
  config: unknown,
): { config: Record<string, unknown>; secrets: string[] } {
  const source = isRecord(config) ? config : {};
  const copy: Record<string, unknown> = { ...source };
  const secrets: string[] = [];
  for (const field of channelSecretFields[type]) {
    if (field === "headers") continue;
    const value = copy[field];
    if (typeof value === "string" && value.length > 0) {
      secrets.push(field);
      copy[field] = "";
    }
  }
  if (type === "webhook" && Array.isArray(copy.headers)) {
    let any = false;
    copy.headers = copy.headers.map((header) => {
      if (!isRecord(header)) return header;
      if (typeof header.value === "string" && header.value.length > 0) {
        any = true;
        return { ...header, value: "" };
      }
      return header;
    });
    if (any) secrets.push("headers");
  }
  return { config: copy, secrets };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hostnameOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export function channelDestination(type: ChannelType, config: unknown): string {
  const value = isRecord(config) ? config : {};
  switch (type) {
    case "email":
      return text(value.to);
    case "discord":
    case "slack":
    case "teams":
    case "google_chat":
      return hostnameOf(value.webhookUrl);
    case "webhook":
      return hostnameOf(value.url);
    case "telegram":
      return text(value.chatId);
    case "ntfy": {
      const host = hostnameOf(value.server);
      const topic = text(value.topic);
      if (host && topic) return `${topic} @ ${host}`;
      return topic || host;
    }
    case "gotify":
      return hostnameOf(value.server);
    case "pushover":
      return text(value.device);
    case "matrix":
      return text(value.roomId);
  }
}

export type ChannelDraft = {
  name: string;
  type: ChannelType;
  to: string;
  discordUrl: string;
  slackUrl: string;
  teamsUrl: string;
  googleChatUrl: string;
  webhookUrl: string;
  headers: { id: string; name: string; value: string }[];
  botToken: string;
  chatId: string;
  ntfyServer: string;
  ntfyTopic: string;
  ntfyToken: string;
  ntfyPriority: string;
  ntfyTags: string;
  gotifyServer: string;
  gotifyToken: string;
  gotifyPriority: string;
  pushoverUser: string;
  pushoverToken: string;
  pushoverDevice: string;
  pushoverPriority: string;
  pushoverSound: string;
  matrixServer: string;
  matrixToken: string;
  matrixRoom: string;
  clearSecrets: string[];
};

export type ChannelField = Exclude<keyof ChannelDraft, "type" | "clearSecrets">;

export type ChannelErrorCode = "required" | "invalid" | "blocked";

function emptyDraft(type: ChannelType): ChannelDraft {
  return {
    name: "",
    type,
    to: "",
    discordUrl: "",
    slackUrl: "",
    teamsUrl: "",
    googleChatUrl: "",
    webhookUrl: "",
    headers: [],
    botToken: "",
    chatId: "",
    ntfyServer: "https://ntfy.sh",
    ntfyTopic: "",
    ntfyToken: "",
    ntfyPriority: "",
    ntfyTags: "",
    gotifyServer: "",
    gotifyToken: "",
    gotifyPriority: "",
    pushoverUser: "",
    pushoverToken: "",
    pushoverDevice: "",
    pushoverPriority: "",
    pushoverSound: "",
    matrixServer: "",
    matrixToken: "",
    matrixRoom: "",
    clearSecrets: [],
  };
}

export function blankChannelDraft(type: ChannelType = "email"): ChannelDraft {
  return emptyDraft(type);
}

function str(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

function headersFrom(config: Record<string, unknown>): ChannelDraft["headers"] {
  if (!Array.isArray(config.headers)) return [];
  return config.headers.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      {
        id: crypto.randomUUID(),
        name: typeof item.name === "string" ? item.name : "",
        value: typeof item.value === "string" ? item.value : "",
      },
    ];
  });
}

export function draftFromChannel(channel: {
  name: string;
  type: string;
  config?: Record<string, unknown> | null;
}): ChannelDraft {
  const type = isChannelType(channel.type) ? channel.type : "email";
  const draft = emptyDraft(type);
  draft.name = channel.name;
  const config = channel.config ?? {};
  switch (type) {
    case "email":
      draft.to = str(config, "to");
      break;
    case "discord":
      draft.discordUrl = str(config, "webhookUrl");
      break;
    case "slack":
      draft.slackUrl = str(config, "webhookUrl");
      break;
    case "teams":
      draft.teamsUrl = str(config, "webhookUrl");
      break;
    case "google_chat":
      draft.googleChatUrl = str(config, "webhookUrl");
      break;
    case "telegram":
      draft.botToken = str(config, "botToken");
      draft.chatId = str(config, "chatId");
      break;
    case "webhook":
      draft.webhookUrl = str(config, "url");
      draft.headers = headersFrom(config);
      break;
    case "ntfy":
      draft.ntfyServer = str(config, "server") || "https://ntfy.sh";
      draft.ntfyTopic = str(config, "topic");
      draft.ntfyToken = str(config, "token");
      draft.ntfyPriority = str(config, "priority");
      draft.ntfyTags = str(config, "tags");
      break;
    case "gotify":
      draft.gotifyServer = str(config, "server");
      draft.gotifyToken = str(config, "token");
      draft.gotifyPriority = str(config, "priority");
      break;
    case "pushover":
      draft.pushoverUser = str(config, "userKey");
      draft.pushoverToken = str(config, "appToken");
      draft.pushoverDevice = str(config, "device");
      draft.pushoverPriority = str(config, "priority");
      draft.pushoverSound = str(config, "sound");
      break;
    case "matrix":
      draft.matrixServer = str(config, "homeserver");
      draft.matrixToken = str(config, "accessToken");
      draft.matrixRoom = str(config, "roomId");
      break;
  }
  return draft;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

function assignOptional(
  config: Record<string, unknown>,
  key: string,
  value: string,
) {
  const trimmed = value.trim();
  if (trimmed) config[key] = trimmed;
}

export function channelPayload(draft: ChannelDraft): {
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  clearSecrets?: string[];
} {
  const config: Record<string, unknown> = {};
  switch (draft.type) {
    case "email":
      config.to = draft.to.trim();
      break;
    case "discord":
      config.webhookUrl = draft.discordUrl.trim();
      break;
    case "slack":
      config.webhookUrl = draft.slackUrl.trim();
      break;
    case "teams":
      config.webhookUrl = draft.teamsUrl.trim();
      break;
    case "google_chat":
      config.webhookUrl = draft.googleChatUrl.trim();
      break;
    case "telegram":
      config.botToken = draft.botToken.trim();
      config.chatId = draft.chatId.trim();
      break;
    case "webhook": {
      config.url = draft.webhookUrl.trim();
      const headers = draft.headers
        .map((header) => ({ name: header.name.trim(), value: header.value }))
        .filter((header) => header.name || header.value);
      if (headers.length > 0) config.headers = headers;
      break;
    }
    case "ntfy":
      config.server = draft.ntfyServer.trim();
      config.topic = draft.ntfyTopic.trim();
      assignOptional(config, "token", draft.ntfyToken);
      if (draft.ntfyPriority.trim())
        config.priority = optionalNumber(draft.ntfyPriority);
      assignOptional(config, "tags", draft.ntfyTags);
      break;
    case "gotify":
      config.server = draft.gotifyServer.trim();
      config.token = draft.gotifyToken.trim();
      if (draft.gotifyPriority.trim())
        config.priority = optionalNumber(draft.gotifyPriority);
      break;
    case "pushover":
      config.userKey = draft.pushoverUser.trim();
      config.appToken = draft.pushoverToken.trim();
      assignOptional(config, "device", draft.pushoverDevice);
      if (draft.pushoverPriority.trim())
        config.priority = optionalNumber(draft.pushoverPriority);
      assignOptional(config, "sound", draft.pushoverSound);
      break;
    case "matrix":
      config.homeserver = draft.matrixServer.trim();
      config.accessToken = draft.matrixToken.trim();
      config.roomId = draft.matrixRoom.trim();
      break;
  }
  const clearSecrets = [
    ...new Set(draft.clearSecrets.map((field) => field.trim())),
  ].filter(Boolean);
  return {
    name: draft.name.trim(),
    type: draft.type,
    config,
    ...(clearSecrets.length > 0 ? { clearSecrets } : {}),
  };
}

function secretPlaceholder(field: string): string {
  switch (field) {
    case "webhookUrl":
    case "url":
    case "server":
    case "homeserver":
      return "https://example.com/saved";
    case "userKey":
    case "appToken":
      return "a".repeat(30);
    default:
      return "saved-secret-token";
  }
}

function placeholderStore(
  savedSecrets: readonly string[],
): Record<string, unknown> | null {
  const fields = savedSecrets.filter((field) => field !== "headers");
  if (fields.length === 0) return null;
  const config: Record<string, unknown> = {};
  for (const field of fields) config[field] = secretPlaceholder(field);
  return config;
}

function fieldFor(type: ChannelType, path: string): ChannelField | null {
  const key = path.split(".")[0] ?? "";
  switch (type) {
    case "email":
      return key === "to" ? "to" : null;
    case "discord":
      return key === "webhookUrl" ? "discordUrl" : null;
    case "slack":
      return key === "webhookUrl" ? "slackUrl" : null;
    case "teams":
      return key === "webhookUrl" ? "teamsUrl" : null;
    case "google_chat":
      return key === "webhookUrl" ? "googleChatUrl" : null;
    case "telegram":
      if (key === "botToken") return "botToken";
      if (key === "chatId") return "chatId";
      return null;
    case "webhook":
      if (key === "url") return "webhookUrl";
      if (key === "headers") return "headers";
      return null;
    case "ntfy":
      if (key === "server") return "ntfyServer";
      if (key === "topic") return "ntfyTopic";
      if (key === "token") return "ntfyToken";
      if (key === "priority") return "ntfyPriority";
      if (key === "tags") return "ntfyTags";
      return null;
    case "gotify":
      if (key === "server") return "gotifyServer";
      if (key === "token") return "gotifyToken";
      if (key === "priority") return "gotifyPriority";
      return null;
    case "pushover":
      if (key === "userKey") return "pushoverUser";
      if (key === "appToken") return "pushoverToken";
      if (key === "device") return "pushoverDevice";
      if (key === "priority") return "pushoverPriority";
      if (key === "sound") return "pushoverSound";
      return null;
    case "matrix":
      if (key === "homeserver") return "matrixServer";
      if (key === "accessToken") return "matrixToken";
      if (key === "roomId") return "matrixRoom";
      return null;
  }
}

function codeOf(message: string): ChannelErrorCode {
  if (message === "blocked") return "blocked";
  if (message === "required") return "required";
  return "invalid";
}

export function channelFieldErrors(
  draft: ChannelDraft,
  savedSecrets: readonly string[] = [],
): Partial<Record<ChannelField, ChannelErrorCode>> {
  const errors: Partial<Record<ChannelField, ChannelErrorCode>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > 80) errors.name = "invalid";
  const payload = channelPayload(draft);
  const kept = savedSecrets.filter(
    (field) => !draft.clearSecrets.includes(field),
  );
  const resolved = resolveChannelConfig(
    draft.type,
    payload.config,
    placeholderStore(kept),
    payload.clearSecrets ?? [],
  );
  if (!resolved.ok) {
    for (const issue of resolved.issues) {
      const field = fieldFor(draft.type, issue.path);
      if (field && !errors[field]) errors[field] = codeOf(issue.message);
    }
  }
  return errors;
}
