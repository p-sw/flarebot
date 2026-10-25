// SPDX-License-Identifier: MIT

import type { MailResult } from "./smtp";

export async function sendCfEmail(
  binding: SendEmail | undefined,
  message: {
    fromName: string;
    fromAddress: string;
    to: string;
    subject: string;
    text: string;
    messageId: string;
  },
): Promise<MailResult> {
  if (!binding) {
    return {
      ok: false,
      stage: "config",
      permanent: true,
      message:
        "The send_email binding is not configured. Add it to wrangler.jsonc after you enable Cloudflare Email Service. On the free plan it can only deliver to addresses you have verified.",
    };
  }
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const from = `${message.fromName} <${message.fromAddress}>`;
    const mime = [
      `From: ${from}`,
      `To: ${message.to}`,
      `Subject: ${encodeSubject(message.subject)}`,
      `Message-ID: ${message.messageId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text,
    ].join("\r\n");
    const email = new EmailMessage(message.fromAddress, message.to, mime);
    await binding.send(email);
    return { ok: true };
  } catch (error) {
    const text =
      error instanceof Error
        ? error.message
        : "Email Service rejected the message";
    return {
      ok: false,
      stage: "send",
      message: text.slice(0, 500),
      permanent: true,
    };
  }
}

function encodeSubject(value: string): string {
  if ([...value].every((char) => char.charCodeAt(0) < 128)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}
