// SPDX-License-Identifier: MIT

import { decryptString } from "../crypto/secret";
import { sendCfEmail } from "./cf-email";
import type { MailResult, SmtpSettings } from "./smtp";
import { sendSmtp } from "./smtp";

export type ResolvedMail = {
  driver: "smtp" | "cf-email" | "test" | "none";
  fromName: string;
  fromAddress: string;
  secretsOverride: boolean;
  smtp?: SmtpSettings;
};

export async function resolveMail(
  env: Env,
  row: {
    driver: string;
    host: string | null;
    port: number | null;
    security: string | null;
    username: string | null;
    passwordEncrypted: string | null;
    fromName: string | null;
    fromAddress: string | null;
  } | null,
): Promise<ResolvedMail> {
  if (env.SMTP_HOST && env.MAIL_FROM) {
    const security = env.SMTP_SECURE === "tls" ? "tls" : "starttls";
    return {
      driver: "smtp",
      fromName: env.MAIL_FROM_NAME || "Flarebot",
      fromAddress: env.MAIL_FROM,
      secretsOverride: true,
      smtp: {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || (security === "tls" ? 465 : 587)),
        security,
        username: env.SMTP_USER || "",
        password: env.SMTP_PASSWORD || "",
        fromName: env.MAIL_FROM_NAME || "Flarebot",
        fromAddress: env.MAIL_FROM,
      },
    };
  }
  if (!row || row.driver === "none") {
    return {
      driver: "none",
      fromName: "Flarebot",
      fromAddress: "",
      secretsOverride: false,
    };
  }
  if (row.driver === "test" && env.ALLOW_TEST_MAIL === "1") {
    return {
      driver: "test",
      fromName: row.fromName || "Flarebot",
      fromAddress: row.fromAddress || "test@example.com",
      secretsOverride: false,
    };
  }
  if (row.driver === "cf-email") {
    return {
      driver: "cf-email",
      fromName: row.fromName || "Flarebot",
      fromAddress: row.fromAddress || "",
      secretsOverride: false,
    };
  }
  const password =
    row.passwordEncrypted && env.ENCRYPTION_KEY
      ? await decryptString(env.ENCRYPTION_KEY, row.passwordEncrypted)
      : "";
  return {
    driver: "smtp",
    fromName: row.fromName || "Flarebot",
    fromAddress: row.fromAddress || "",
    secretsOverride: false,
    smtp: {
      host: row.host || "",
      port: row.port || 587,
      security: row.security === "tls" ? "tls" : "starttls",
      username: row.username || "",
      password,
      fromName: row.fromName || "Flarebot",
      fromAddress: row.fromAddress || "",
    },
  };
}

export async function deliverWith(
  env: Env,
  resolved: ResolvedMail,
  message: { to: string; subject: string; text: string; messageId: string },
): Promise<MailResult> {
  if (resolved.driver === "test") return { ok: true };
  if (resolved.driver === "none" || !resolved.fromAddress) {
    return {
      ok: false,
      stage: "config",
      message: "Email is not configured",
      permanent: true,
    };
  }
  if (resolved.driver === "cf-email") {
    return sendCfEmail(env.EMAIL, {
      ...message,
      fromName: resolved.fromName,
      fromAddress: resolved.fromAddress,
    });
  }
  if (!resolved.smtp)
    return {
      ok: false,
      stage: "config",
      message: "SMTP settings are incomplete",
      permanent: true,
    };
  return sendSmtp(resolved.smtp, message, {
    allowLoopback: env.ALLOW_TEST_MAIL === "1",
  });
}
