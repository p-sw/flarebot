// SPDX-License-Identifier: MIT

import { LogLevel, WorkerMailer } from "worker-mailer";
import type { MailConfigReason } from "../../shared/mail-test";
import { isBlockedHost } from "../../shared/schemas";
import { mailReasonMessage } from "../notify/copy";
import { classifyMailError, inferSmtpStage, type MailStage } from "./retry";

export type SmtpSecurity = "starttls" | "tls" | "none";

export function smtpSecurity(value: string | null | undefined): SmtpSecurity {
  if (value === "tls" || value === "none") return value;
  return "starttls";
}

export type SmtpSettings = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
};

export type MailResult =
  | { ok: true }
  | {
      ok: false;
      stage: MailStage;
      message: string;
      permanent: boolean;
      reason?: MailConfigReason;
    };

export async function sendSmtp(
  settings: SmtpSettings,
  message: {
    to: string;
    subject: string;
    text: string;
    messageId: string;
    headers?: Record<string, string>;
  },
  options?: {
    allowLoopback?: boolean;
    responseTimeoutMs?: number;
    socketTimeoutMs?: number;
    sendTimeoutMs?: number;
  },
): Promise<MailResult> {
  const loopback =
    options?.allowLoopback === true &&
    /^(127\.0\.0\.1|localhost|::1)$/i.test(settings.host.trim());
  if (settings.port === 25) {
    return {
      ok: false,
      stage: "config",
      reason: "port_25",
      permanent: true,
      message: mailReasonMessage("port_25"),
    };
  }
  const allowedPort =
    settings.port === 587 ||
    settings.port === 465 ||
    (loopback && settings.port >= 1024 && settings.port <= 65535);
  if (!allowedPort) {
    return {
      ok: false,
      stage: "config",
      reason: "unsupported_port",
      permanent: true,
      message: mailReasonMessage("unsupported_port"),
    };
  }
  if (isBlockedHost(settings.host) && !loopback) {
    return {
      ok: false,
      stage: "config",
      reason: "blocked_host",
      permanent: true,
      message: mailReasonMessage("blocked_host"),
    };
  }
  const secure = settings.security === "tls";
  const startTls = settings.security === "starttls";
  const started = Date.now();
  try {
    const mailer = await WorkerMailer.connect({
      host: settings.host,
      port: settings.port,
      secure,
      startTls,
      credentials: settings.username
        ? { username: settings.username, password: settings.password }
        : undefined,
      authType: ["plain", "login"],
      logLevel: LogLevel.NONE,
      socketTimeoutMs: options?.socketTimeoutMs ?? 10_000,
      responseTimeoutMs: options?.responseTimeoutMs ?? 15_000,
    });
    try {
      await Promise.race([
        mailer.send({
          from: { name: settings.fromName, email: settings.fromAddress },
          to: message.to,
          subject: message.subject,
          text: message.text,
          headers: {
            "Message-ID": message.messageId,
            ...safeHeaders(message.headers),
          },
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("SMTP send timed out")),
            options?.sendTimeoutMs ?? 30_000,
          ),
        ),
      ]);
    } finally {
      await mailer.close().catch(() => undefined);
    }
    return { ok: true };
  } catch (error) {
    const text = error instanceof Error ? error.message : "SMTP failed";
    const hint = /cloudflare|error 1003|banned/i.test(text)
      ? " If the hostname is proxied by Cloudflare, switch that DNS record to DNS-only."
      : "";
    const messageText = `${text}${hint}`.slice(0, 500);
    return {
      ok: false,
      stage: inferSmtpStage(messageText),
      message: messageText,
      permanent:
        classifyMailError(messageText) === "permanent" ||
        Date.now() - started < 0,
    };
  }
}

function safeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    extra[name.replace(/[^\w-]/g, "")] = value.replace(/[\r\n]/g, "");
  }
  return extra;
}
