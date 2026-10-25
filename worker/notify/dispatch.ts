// SPDX-License-Identifier: MIT

import { t } from "../../shared/copy";
import { channelTestText, type NoticeKind, notificationText } from "./copy";

export type ChannelDelivery = {
  type: "email" | "discord" | "slack" | "telegram" | "webhook";
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
          return { ok: false, error: t("error_email_not_configured") };
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
          return {
            ok: false,
            error: t("error_webhook_status", { status: response.status }),
          };
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
          return {
            ok: false,
            error: t("error_telegram_status", { status: response.status }),
          };
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
          return {
            ok: false,
            error: t("error_webhook_status", { status: response.status }),
          };
        return { ok: true };
      }
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : t("error_delivery_failed"),
    };
  }
}

export function sampleChannelText(name: string): {
  subject: string;
  body: string;
} {
  const body = channelTestText(name);
  return { subject: body, body };
}
