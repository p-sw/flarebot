// SPDX-License-Identifier: MIT

export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];
export const MAX_ATTEMPTS = 5;

export function nextRetryDelay(failedAttempts: number): number | null {
  if (failedAttempts >= MAX_ATTEMPTS) return null;
  return (
    RETRY_DELAYS_MS[Math.min(failedAttempts - 1, RETRY_DELAYS_MS.length - 1)] ??
    null
  );
}

// The reply code is the first three-digit 4xx or 5xx in the message. Later
// numbers are enhanced status codes ("451 4.7.500 Server busy") or free text
// ("try again in 500 seconds") and say nothing about whether to retry.
const REPLY_CODE = /(?<![.\d])[45]\d{2}(?![.\d])/;

export function classifyMailError(message: string): "permanent" | "transient" {
  const code = REPLY_CODE.exec(message)?.[0];
  if (code?.startsWith("5")) return "permanent";
  if (code?.startsWith("4")) return "transient";
  if (
    /auth|authentication|invalid login|bad credentials/.test(
      message.toLowerCase(),
    )
  )
    return "permanent";
  return "transient";
}

export type MailStage = "config" | "connect" | "tls" | "auth" | "send";

export function inferSmtpStage(message: string): MailStage {
  const lower = message.toLowerCase();
  if (/auth|535|534|authentication|invalid login/.test(lower)) return "auth";
  if (/tls|starttls|certificate|handshake/.test(lower)) return "tls";
  if (/connect|econn|enotfound|network|timed out|timeout|refused/.test(lower))
    return "connect";
  return "send";
}
