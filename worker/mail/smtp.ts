// SPDX-License-Identifier: AGPL-3.0-only

import { LogLevel, WorkerMailer } from "worker-mailer";
import { isBlockedHost } from "../../shared/schemas";
import { classifyMailError, inferSmtpStage, type MailStage } from "./retry";

export type SmtpSettings = {
  host: string;
  port: number;
  security: "starttls" | "tls";
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
};

export type MailResult =
  | { ok: true }
  | { ok: false; stage: MailStage; message: string; permanent: boolean };

export async function sendSmtp(
  settings: SmtpSettings,
  message: { to: string; subject: string; text: string; messageId: string },
): Promise<MailResult> {
  if (settings.port === 25) {
    return {
      ok: false,
      stage: "config",
      permanent: true,
      message:
        "Port 25 is blocked on Workers. Use 587 (STARTTLS) or 465 (TLS).",
    };
  }
  if (settings.port !== 587 && settings.port !== 465) {
    return {
      ok: false,
      stage: "config",
      permanent: true,
      message: "Only ports 587 and 465 are supported.",
    };
  }
  if (isBlockedHost(settings.host)) {
    return {
      ok: false,
      stage: "config",
      permanent: true,
      message:
        "That SMTP host is local, private, or otherwise not dialable. Cloudflare also blocks TCP to proxied (orange-cloud) hostnames. Use a DNS-only hostname that is reachable on the public internet.",
    };
  }
  const secure = settings.security === "tls";
  const started = Date.now();
  try {
    const mailer = await WorkerMailer.connect({
      host: settings.host,
      port: settings.port,
      secure,
      startTls: settings.security === "starttls",
      credentials: settings.username
        ? { username: settings.username, password: settings.password }
        : undefined,
      authType: ["plain", "login"],
      logLevel: LogLevel.NONE,
      socketTimeoutMs: 10_000,
      responseTimeoutMs: 15_000,
    });
    try {
      await Promise.race([
        mailer.send({
          from: { name: settings.fromName, email: settings.fromAddress },
          to: message.to,
          subject: message.subject,
          text: message.text,
          headers: { "Message-ID": message.messageId },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SMTP send timed out")), 30_000),
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
