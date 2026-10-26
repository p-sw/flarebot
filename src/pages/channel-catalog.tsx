// SPDX-License-Identifier: MIT

import {
  type ChannelType,
  channelTypes,
  isChannelType,
} from "@shared/channels";
import { t } from "@shared/copy";
import {
  Bell,
  Hash,
  type LucideIcon,
  Mail,
  MessageSquare,
  MessagesSquare,
  Radio,
  Send,
  Smartphone,
  Users,
  Waypoints,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { Input } from "../ui/input";
import { Field } from "./fields";

const icons: Record<ChannelType, LucideIcon> = {
  email: Mail,
  discord: MessagesSquare,
  slack: Hash,
  telegram: Send,
  webhook: Webhook,
  ntfy: Bell,
  gotify: Radio,
  pushover: Smartphone,
  teams: Users,
  google_chat: MessageSquare,
  matrix: Waypoints,
};

export function channelTypeLabel(type: string): string {
  switch (type) {
    case "email":
      return t("channel_type_email");
    case "discord":
      return t("channel_type_discord");
    case "slack":
      return t("channel_type_slack");
    case "telegram":
      return t("channel_type_telegram");
    case "webhook":
      return t("channel_type_webhook");
    case "ntfy":
      return t("channel_type_ntfy");
    case "gotify":
      return t("channel_type_gotify");
    case "pushover":
      return t("channel_type_pushover");
    case "teams":
      return t("channel_type_teams");
    case "google_chat":
      return t("channel_type_google_chat");
    case "matrix":
      return t("channel_type_matrix");
    default:
      return t("channel_type_unknown");
  }
}

export function channelTypeHint(type: string): string {
  switch (type) {
    case "email":
      return t("channel_type_email_hint");
    case "discord":
      return t("channel_type_discord_hint");
    case "slack":
      return t("channel_type_slack_hint");
    case "telegram":
      return t("channel_type_telegram_hint");
    case "webhook":
      return t("channel_type_webhook_hint");
    case "ntfy":
      return t("channel_type_ntfy_hint");
    case "gotify":
      return t("channel_type_gotify_hint");
    case "pushover":
      return t("channel_type_pushover_hint");
    case "teams":
      return t("channel_type_teams_hint");
    case "google_chat":
      return t("channel_type_google_chat_hint");
    case "matrix":
      return t("channel_type_matrix_hint");
    default:
      return "";
  }
}

export function ChannelGlyph({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const Icon = isChannelType(type) ? icons[type] : Bell;
  return <Icon className={className ?? "size-4"} aria-hidden />;
}

export function ChannelTypePicker({
  value,
  onChange,
}: {
  value: ChannelType;
  onChange: (type: ChannelType) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = channelTypes.filter((type) => {
    if (!needle) return true;
    return `${channelTypeLabel(type)} ${channelTypeHint(type)}`
      .toLowerCase()
      .includes(needle);
  });
  return (
    <div className="grid min-w-0 gap-2">
      <Field label={t("channel_type_search")} hint={t("channel_type_hint")}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </Field>
      <div
        role="listbox"
        aria-label={t("channel_type")}
        className="grid max-h-48 min-w-0 gap-1 overflow-y-auto sm:grid-cols-2"
      >
        {matches.map((type) => {
          const selected = type === value;
          return (
            <button
              key={type}
              type="button"
              role="option"
              aria-selected={selected}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm",
                selected
                  ? "border-primary bg-muted"
                  : "border-border hover:bg-muted",
              )}
              onClick={() => onChange(type)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
                <ChannelGlyph type={type} />
              </span>
              <span className="min-w-0 break-words font-medium">
                {channelTypeLabel(type)}
              </span>
            </button>
          );
        })}
      </div>
      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("channel_type_none")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {channelTypeHint(value)}
        </p>
      )}
    </div>
  );
}
