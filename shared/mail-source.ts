// SPDX-License-Identifier: MIT

export type MailSource = "secrets" | "database" | "cloudflare" | "none";

export function describeMailSource(
  env: { SMTP_HOST?: string; MAIL_FROM?: string },
  driver: string | null | undefined,
): MailSource {
  if (env.SMTP_HOST && env.MAIL_FROM) return "secrets";
  if (driver === "cf-email") return "cloudflare";
  if (driver === "smtp") return "database";
  return "none";
}
