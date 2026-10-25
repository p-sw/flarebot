// SPDX-License-Identifier: MIT

import { z } from "zod";
import { ROLES, SCOPES } from "./permissions";
import { statusSlugPattern } from "./status-layout";

const privateHost =
  /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?|\[?fe80:)/i;

export function isBlockedHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (privateHost.test(normalized)) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal"))
    return true;
  return false;
}

export const httpConfigSchema = z.object({
  url: z.string().url().max(2000),
  method: z
    .enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
    .default("GET"),
  headers: z
    .array(
      z.object({ name: z.string().min(1).max(80), value: z.string().max(500) }),
    )
    .max(20)
    .default([]),
  body: z.string().max(8000).optional(),
  followRedirects: z.boolean().default(true),
  expectedStatuses: z
    .array(z.number().int().min(100).max(599))
    .min(1)
    .max(20)
    .default([200]),
  keyword: z.string().max(500).optional(),
  keywordMode: z.enum(["present", "absent"]).default("present"),
  jsonPath: z.string().max(200).optional(),
  jsonExpect: z.string().max(500).optional(),
});

export const tcpConfigSchema = z
  .object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
  })
  .superRefine((value, ctx) => {
    if (value.port === 25) {
      ctx.addIssue({
        code: "custom",
        message: "Port 25 is blocked. Use 587 or 465 for mail.",
        path: ["port"],
      });
    }
    if (isBlockedHost(value.host)) {
      ctx.addIssue({
        code: "custom",
        message: "Private and local hosts cannot be checked.",
        path: ["host"],
      });
    }
  });

export const dnsConfigSchema = z.object({
  name: z.string().min(1).max(253),
  type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT"]),
  expected: z.array(z.string().min(1).max(500)).min(1).max(20),
  resolver: z.string().url().optional(),
});

export const sslConfigSchema = z.object({
  host: z.string().min(1).max(253),
  warnDays: z.number().int().min(1).max(365).default(14),
});

export const heartbeatConfigSchema = z.object({
  graceSeconds: z.number().int().min(0).max(86_400).default(30),
});

export const monitorTypeSchema = z.enum([
  "http",
  "tcp",
  "dns",
  "ssl",
  "heartbeat",
]);
export type MonitorType = z.infer<typeof monitorTypeSchema>;

export const monitorWriteSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: monitorTypeSchema,
    config: z.unknown(),
    intervalSeconds: z.number().int().min(60).max(86_400).default(60),
    timeoutSeconds: z.number().int().min(1).max(30).default(10),
    retries: z.number().int().min(1).max(5).default(2),
    recoveryThreshold: z.number().int().min(1).max(5).default(1),
    channelIds: z.array(z.string().uuid()).max(20).default([]),
    paused: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const parsed = parseMonitorConfig(value.type, value.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
      }
    }
    if (value.type === "http" && parsed.success) {
      const url = new URL(
        (parsed.data as z.infer<typeof httpConfigSchema>).url,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        isBlockedHost(url.hostname)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "URL host is not allowed.",
          path: ["config", "url"],
        });
      }
    }
    if (
      value.type === "ssl" &&
      parsed.success &&
      isBlockedHost((parsed.data as { host: string }).host)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Private and local hosts cannot be checked.",
        path: ["config", "host"],
      });
    }
    if (
      value.type === "dns" &&
      parsed.success &&
      isBlockedHost((parsed.data as { name: string }).name)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Private and local names cannot be checked.",
        path: ["config", "name"],
      });
    }
  });

export function parseMonitorConfig(type: MonitorType, config: unknown) {
  switch (type) {
    case "http":
      return httpConfigSchema.safeParse(config);
    case "tcp":
      return tcpConfigSchema.safeParse(config);
    case "dns":
      return dnsConfigSchema.safeParse(config);
    case "ssl":
      return sslConfigSchema.safeParse(config);
    case "heartbeat":
      return heartbeatConfigSchema.safeParse(config);
  }
}

export const channelTypeSchema = z.enum([
  "email",
  "discord",
  "slack",
  "telegram",
  "webhook",
]);

export const channelWriteSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: channelTypeSchema,
    config: z.unknown(),
  })
  .superRefine((value, ctx) => {
    const parsed = parseChannelConfig(value.type, value.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
      }
    }
  });

export function parseChannelConfig(
  type: z.infer<typeof channelTypeSchema>,
  config: unknown,
) {
  switch (type) {
    case "email":
      return z.object({ to: z.string().email() }).safeParse(config);
    case "discord":
    case "slack":
      return z.object({ webhookUrl: z.string().url() }).safeParse(config);
    case "telegram":
      return z
        .object({
          botToken: z.string().min(10).max(200),
          chatId: z.string().min(1).max(64),
        })
        .safeParse(config);
    case "webhook":
      return z
        .object({
          url: z.string().url(),
          headers: z
            .array(
              z.object({
                name: z.string().min(1).max(80),
                value: z.string().max(500),
              }),
            )
            .max(10)
            .optional(),
        })
        .safeParse(config);
  }
}

const slugSchema = z.string().regex(statusSlugPattern).max(60);

export const statusPageWriteSchema = z.object({
  slug: slugSchema,
  published: z.boolean().default(true),
  serveAtRoot: z.boolean().optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(""),
  footer: z.string().max(2000).default(""),
  banner: z.string().max(500).default(""),
  logoUrl: z.string().url().max(2000).optional().or(z.literal("")),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        monitorId: z.string().uuid(),
        position: z.number().int().min(0).max(500),
        groupName: z.string().max(80).default(""),
        displayName: z.string().max(120).default(""),
      }),
    )
    .max(200),
});

export const statusPageRootSchema = z.object({
  serveAtRoot: z.boolean(),
});

export const setupSchema = z.object({
  setupSecret: z.string().min(8).max(200),
  turnstileToken: z.string().optional(),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  turnstileToken: z.string().optional(),
});

export const mailSettingsSchema = z.discriminatedUnion("driver", [
  z.object({ driver: z.literal("none") }),
  z.object({
    driver: z.literal("smtp"),
    host: z.string().min(1).max(253),
    port: z.union([z.literal(587), z.literal(465)]),
    security: z.enum(["starttls", "tls", "none"]),
    username: z.string().max(200).default(""),
    password: z.string().max(200).optional(),
    clearPassword: z.boolean().optional(),
    fromName: z.string().min(1).max(80),
    fromAddress: z.string().email(),
  }),
  z.object({
    driver: z.literal("cf-email"),
    fromName: z.string().min(1).max(80),
    fromAddress: z.string().email(),
  }),
]);

export const inviteSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]),
  email: z.string().email().optional(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

export const tokenCreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export const roleChangeSchema = z.object({
  role: z.enum(ROLES),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const accountPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

export const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(10).max(200),
});

export const forgotSchema = z.object({
  email: z.string().email(),
});

export const totpConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const MIN_INTERVAL_SECONDS = 60;
