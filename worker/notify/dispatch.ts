// SPDX-License-Identifier: MIT

import {
  type ChannelType,
  channelTypeSchema,
  publicUrlProblem,
} from "../../shared/channels";
import { t } from "../../shared/copy";
import { channelTestText, type NoticeKind, notificationText } from "./copy";

export type ChannelDelivery = {
  type: ChannelType;
  config: Record<string, unknown>;
};

type FetchImpl = typeof fetch;

// One request per channel. Email is queued on the mail outbox, which already
// retries. Repeating these HTTP calls here would multiply subrequests on the
// scheduler invocation that confirmed the outage.
export async function deliverChannel(
  channel: ChannelDelivery,
  message: { kind: NoticeKind; monitorName: string; reason: string },
  deps: {
    fetch?: FetchImpl;
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
  const parsedType = channelTypeSchema.safeParse(channel.type);
  if (!parsedType.success)
    return { ok: false, error: t("error_unknown_channel") };
  try {
    switch (parsedType.data) {
      case "email": {
        const to = String(channel.config.to ?? "");
        if (!to || !deps.enqueueEmail)
          return { ok: false, error: t("error_email_not_configured") };
        await deps.enqueueEmail({
          to,
          subject: text.subject,
          text: text.body,
        });
        return { ok: true };
      }
      case "discord":
      case "slack":
        return await postJson(
          fetchImpl,
          String(channel.config.webhookUrl ?? ""),
          parsedType.data === "discord"
            ? { content: text.body.slice(0, 1900) }
            : { text: text.body },
          "error_webhook_status",
        );
      case "telegram": {
        const token = encodeURIComponent(String(channel.config.botToken ?? ""));
        return await postJson(
          fetchImpl,
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: channel.config.chatId, text: text.body },
          "error_telegram_status",
        );
      }
      case "webhook": {
        const headers: Record<string, string> = {};
        for (const header of (channel.config.headers as
          | { name?: string; value?: string }[]
          | undefined) ?? []) {
          if (header.name) headers[header.name] = String(header.value ?? "");
        }
        return await postJson(
          fetchImpl,
          String(channel.config.url ?? ""),
          {
            event: message.kind,
            monitor: message.monitorName,
            reason: message.reason,
            text: text.body,
          },
          "error_webhook_status",
          { headers },
        );
      }
      case "ntfy":
        return await postJson(
          fetchImpl,
          trimSlash(String(channel.config.server ?? "")),
          {
            topic: channel.config.topic,
            title: clip(text.subject, 250),
            message: clip(text.body, 4000),
            priority: ntfyPriority(message.kind, channel.config.priority),
            tags: ntfyTags(message.kind, String(channel.config.tags ?? "")),
          },
          "error_ntfy_status",
          { headers: bearer(channel.config.token) },
        );
      case "gotify":
        return await postJson(
          fetchImpl,
          `${trimSlash(String(channel.config.server ?? ""))}/message`,
          {
            title: clip(text.subject, 200),
            message: clip(text.body, 4000),
            priority: gotifyPriority(message.kind, channel.config.priority),
          },
          "error_gotify_status",
          {
            headers: {
              "X-Gotify-Key": String(channel.config.token ?? ""),
            },
          },
        );
      case "pushover":
        return await postJson(
          fetchImpl,
          "https://api.pushover.net/1/messages.json",
          pushoverBody(channel.config, text, message.kind),
          "error_pushover_status",
        );
      case "teams":
        return await postJson(
          fetchImpl,
          String(channel.config.webhookUrl ?? ""),
          teamsCard(text, message.kind),
          "error_teams_status",
        );
      case "google_chat":
        return await postJson(
          fetchImpl,
          String(channel.config.webhookUrl ?? ""),
          googleChatCard(text, message.monitorName),
          "error_google_chat_status",
        );
      case "matrix": {
        const room = encodeURIComponent(String(channel.config.roomId ?? ""));
        const txn = crypto.randomUUID();
        return await postJson(
          fetchImpl,
          `${trimSlash(String(channel.config.homeserver ?? ""))}/_matrix/client/v3/rooms/${room}/send/m.room.message/${txn}`,
          {
            msgtype: "m.text",
            body: clip(`${text.subject}\n\n${text.body}`, 4000),
          },
          "error_matrix_status",
          {
            method: "PUT",
            headers: bearer(channel.config.accessToken),
          },
        );
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

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function bearer(token: unknown): Record<string, string> {
  const value = String(token ?? "").trim();
  if (!value) return {};
  return { authorization: `Bearer ${value}` };
}

async function postJson(
  fetchImpl: FetchImpl,
  url: string,
  body: unknown,
  errorKey:
    | "error_webhook_status"
    | "error_telegram_status"
    | "error_ntfy_status"
    | "error_gotify_status"
    | "error_pushover_status"
    | "error_teams_status"
    | "error_google_chat_status"
    | "error_matrix_status",
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; error?: string }> {
  const problem = publicUrlProblem(url);
  if (problem === "blocked")
    return { ok: false, error: t("error_channel_blocked") };
  if (problem) return { ok: false, error: t("error_delivery_failed") };
  const response = await fetchImpl(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    return { ok: false, error: t(errorKey, { status: response.status }) };
  return { ok: true };
}

function ntfyPriority(kind: NoticeKind, value: unknown): number {
  if (typeof value === "number") return value;
  if (kind === "down") return 5;
  if (kind === "unstable") return 4;
  return 3;
}

function ntfyTags(kind: NoticeKind, raw: string): string[] {
  const custom = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (custom.length > 0) return custom;
  if (kind === "down") return ["rotating_light"];
  if (kind === "up") return ["white_check_mark"];
  return ["warning"];
}

function gotifyPriority(kind: NoticeKind, value: unknown): number {
  if (typeof value === "number") return value;
  if (kind === "down") return 8;
  if (kind === "unstable") return 5;
  return 2;
}

function pushoverPriority(kind: NoticeKind, value: unknown): number {
  if (typeof value === "number") return value;
  if (kind === "down") return 1;
  return 0;
}

function pushoverBody(
  config: Record<string, unknown>,
  text: { subject: string; body: string },
  kind: NoticeKind,
): Record<string, unknown> {
  const priority = pushoverPriority(kind, config.priority);
  const body: Record<string, unknown> = {
    token: config.appToken,
    user: config.userKey,
    title: clip(text.subject, 250),
    message: clip(text.body, 1024),
    priority,
  };
  const device = String(config.device ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");
  if (device) body.device = device;
  const sound = String(config.sound ?? "").trim();
  if (sound) body.sound = sound;
  if (priority === 2) {
    body.retry = 60;
    body.expire = 3600;
  }
  return body;
}

function teamsCard(
  text: { subject: string; body: string },
  kind: NoticeKind,
): Record<string, unknown> {
  const color =
    kind === "up" ? "Good" : kind === "unstable" ? "Warning" : "Attention";
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: clip(text.subject, 200),
              weight: "Bolder",
              size: "Medium",
              color,
              wrap: true,
            },
            {
              type: "TextBlock",
              text: clip(text.body, 2000),
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}

function googleChatCard(
  text: { subject: string; body: string },
  monitorName: string,
): Record<string, unknown> {
  return {
    text: clip(text.body, 4000),
    cardsV2: [
      {
        cardId: "flarebot-alert",
        card: {
          header: {
            title: clip(text.subject, 200),
            subtitle: clip(monitorName, 200),
          },
          sections: [
            {
              widgets: [{ textParagraph: { text: clip(text.body, 4000) } }],
            },
          ],
        },
      },
    ],
  };
}
