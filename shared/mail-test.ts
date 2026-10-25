// SPDX-License-Identifier: MIT

import { z } from "zod";
import { isBlockedHost, mailSettingsSchema } from "./schemas";

export const MAIL_CONFIG_REASONS = [
  "not_configured",
  "missing_from",
  "incomplete_smtp",
  "port_25",
  "unsupported_port",
  "blocked_host",
  "missing_binding",
  "missing_encryption_key",
] as const;

export type MailConfigReason = (typeof MAIL_CONFIG_REASONS)[number];

export type MailTestSource = "secrets" | "saved" | "form";

export type MailTestInput =
  | { driver: "none"; email?: string }
  | {
      driver: "cf-email";
      fromName: string;
      fromAddress: string;
      email?: string;
    }
  | {
      driver: "smtp";
      host: string;
      port: number;
      security: "starttls" | "tls" | "none";
      username: string;
      password?: string;
      clearPassword?: boolean;
      fromName: string;
      fromAddress: string;
      email?: string;
    };

const recipientSchema = z.object({
  email: z.string().email().optional(),
});

const STAGE_NAMES = new Set([
  "config",
  "connect",
  "tls",
  "auth",
  "send",
  "timeout",
]);

export function isMailConfigReason(value: string): value is MailConfigReason {
  return (MAIL_CONFIG_REASONS as readonly string[]).includes(value);
}

export function parseMailTestBody(
  input: unknown,
): { ok: true; data: MailTestInput } | { ok: false; message: string } {
  const recipient = recipientSchema.safeParse(input ?? {});
  if (!recipient.success) return { ok: false, message: "Invalid email" };
  const settings = mailSettingsSchema.safeParse(input);
  if (!settings.success) {
    return {
      ok: false,
      message: settings.error.issues[0]?.message ?? "Invalid request",
    };
  }
  return {
    ok: true,
    data: { ...settings.data, email: recipient.data.email },
  };
}

export function parseMailRecipient(
  input: unknown,
): { ok: true; email?: string } | { ok: false; message: string } {
  const recipient = recipientSchema.safeParse(input ?? {});
  if (!recipient.success) return { ok: false, message: "Invalid email" };
  return { ok: true, email: recipient.data.email };
}

/**
 * Known configuration problems that `mailSettingsSchema` rejects or that
 * should be reported before a socket opens. Returns null when the payload
 * should be judged by the schema (or by the SMTP driver) instead.
 */
export function diagnoseMailInput(input: unknown): MailConfigReason | null {
  if (!input || typeof input !== "object") return "not_configured";
  const body = input as Record<string, unknown>;
  const driver = body.driver;
  if (driver === undefined || driver === "" || driver === "none")
    return "not_configured";
  if (driver === "cf-email") {
    const fromAddress =
      typeof body.fromAddress === "string" ? body.fromAddress.trim() : "";
    if (!fromAddress) return "missing_from";
    return null;
  }
  if (driver !== "smtp") return null;
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const fromName =
    typeof body.fromName === "string" ? body.fromName.trim() : "";
  const fromAddress =
    typeof body.fromAddress === "string" ? body.fromAddress.trim() : "";
  const security = body.security;
  const securityOk =
    security === "starttls" || security === "tls" || security === "none";
  const portOk = typeof body.port === "number" && Number.isInteger(body.port);
  if (!host || !fromName || !securityOk || !portOk) return "incomplete_smtp";
  if (!fromAddress) return "missing_from";
  if (body.port === 25) return "port_25";
  if (body.port !== 587 && body.port !== 465) return "unsupported_port";
  if (isBlockedHost(host)) return "blocked_host";
  return null;
}

export function redactMailDetail(
  message: string | undefined,
  secrets: string[] = [],
): string | undefined {
  if (!message) return undefined;
  let text = "";
  for (const char of message) {
    const code = char.charCodeAt(0);
    text += code >= 32 && code !== 127 ? char : " ";
  }
  text = text.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 3) text = text.split(trimmed).join("[redacted]");
  }
  text = text.replace(
    /\b(?:password|passwd|secret)\s*[:=]\s*\S+/gi,
    "[redacted]",
  );
  text = text.replace(
    /v1\.[A-Za-z0-9+/=]{8,}\.[A-Za-z0-9+/=]{8,}/g,
    "[redacted]",
  );
  if (!text || text === "[redacted]" || STAGE_NAMES.has(text.toLowerCase()))
    return undefined;
  if (/encryption_key\s*[:=]/i.test(text)) return undefined;
  return text.slice(0, 180);
}

export function encodeMailFailure(input: {
  stage: string;
  reason?: string;
  detail?: string;
}): string {
  return JSON.stringify({
    stage: input.stage,
    reason: input.reason ?? null,
    detail: input.detail ?? null,
  });
}

export function parseStoredMailError(stored: string | null | undefined): {
  stage?: string;
  reason?: string;
  detail?: string;
} | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as {
      stage?: unknown;
      reason?: unknown;
      detail?: unknown;
    };
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.stage === "string"
    ) {
      return {
        stage: parsed.stage,
        reason:
          typeof parsed.reason === "string" && parsed.reason
            ? parsed.reason
            : undefined,
        detail:
          typeof parsed.detail === "string" && parsed.detail
            ? parsed.detail
            : undefined,
      };
    }
  } catch {
    // Older rows stored "stage: message".
  }
  const match = /^([a-z]+):\s*(.*)$/i.exec(stored);
  if (!match?.[1]) return { detail: stored };
  return {
    stage: match[1].toLowerCase(),
    detail: match[2]?.trim() || undefined,
  };
}
