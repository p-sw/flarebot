// SPDX-License-Identifier: MIT

import { channelTestText, type NoticeKind, notificationText } from "./copy";

export type ChannelDelivery = {
  type: "email" | "discord" | "slack" | "telegram" | "webhook";
  locale: string | null;
  config: Record<string, unknown>;
};

export async function deliverChannel(
  channel: ChannelDelivery,
  message: { kind: NoticeKind; monitorName: string; reason: string },
  deps: {
    fetch?: typeof fetch;
    enqueueEmail?: (input: {
      to: string;
      subject: string;
      text: string;
    }) => Promise<void>;
  },
): Promise<{ ok: boolean; error?: string }> {
  const text = notificationText(
    channel.locale,
    message.kind,
    message.monitorName,
    message.reason,
  );
  const fetchImpl = deps.fetch ?? fetch;
  try {
    switch (channel.type) {
      case "email": {
        const to = String(channel.config.to ?? "");
        if (!to || !deps.enqueueEmail)
          return { ok: false, error: "Email is not configured" };
        await deps.enqueueEmail({ to, subject: text.subject, text: text.body });
        return { ok: true };
      }
      case "discord":
      case "slack": {
        const response = await fetchImpl(String(channel.config.webhookUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            channel.type === "discord"
              ? { content: text.body.slice(0, 1900) }
              : { text: text.body },
          ),
        });
        if (!response.ok)
          return { ok: false, error: `Webhook returned ${response.status}` };
        return { ok: true };
      }
      case "telegram": {
        const token = String(channel.config.botToken ?? "");
        const response = await fetchImpl(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: channel.config.chatId,
              text: text.body,
            }),
          },
        );
        if (!response.ok)
          return { ok: false, error: `Telegram returned ${response.status}` };
        return { ok: true };
      }
      case "webhook": {
        const headers = new Headers({ "content-type": "application/json" });
        for (const header of (channel.config.headers as
          | { name: string; value: string }[]
          | undefined) ?? []) {
          headers.set(header.name, header.value);
        }
        const response = await fetchImpl(String(channel.config.url), {
          method: "POST",
          headers,
          body: JSON.stringify({
            event: message.kind,
            monitor: message.monitorName,
            reason: message.reason,
            text: text.body,
          }),
        });
        if (!response.ok)
          return { ok: false, error: `Webhook returned ${response.status}` };
        return { ok: true };
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Delivery failed",
    };
  }
}

export function sampleChannelText(
  locale: string | null,
  name: string,
): { subject: string; body: string } {
  const body = channelTestText(locale, name);
  return { subject: body, body };
}
