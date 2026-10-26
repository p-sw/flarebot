// SPDX-License-Identifier: MIT

import * as Dialog from "@radix-ui/react-dialog";
import {
  blankChannelDraft,
  type ChannelDraft,
  type ChannelErrorCode,
  type ChannelField,
  type ChannelType,
  channelFieldErrors,
  channelPayload,
  draftFromChannel,
  isChannelType,
} from "@shared/channels";
import { t } from "@shared/copy";
import { motion } from "motion/react";
import { useState } from "react";
import { api, errorText } from "../lib/api";
import type { ChannelRecord } from "../lib/queries";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { useMotionPrefs } from "../motion/page";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { ChannelTypePicker } from "./channel-catalog";
import { controlClass, Field } from "./fields";

export function ChannelFormDialog({
  channel,
  onClose,
  onSaved,
}: {
  channel?: ChannelRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const motionPrefs = useMotionPrefs();
  const submit = useSubmitGuard();
  const initialType = isChannelType(channel?.type ?? "")
    ? (channel?.type as ChannelType)
    : "email";
  const initialSecrets = channel?.secrets ?? [];
  const [draft, setDraft] = useState<ChannelDraft>(() => {
    if (channel) return draftFromChannel(channel);
    const created = blankChannelDraft();
    created.name = t("channel_name_default");
    return created;
  });
  const [errors, setErrors] = useState<
    Partial<Record<ChannelField, ChannelErrorCode>>
  >({});
  const [formError, setFormError] = useState("");
  const savedSecrets = draft.type === initialType ? initialSecrets : [];

  function patch(next: Partial<ChannelDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function setClear(field: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      clearSecrets: checked
        ? [...new Set([...current.clearSecrets, field])]
        : current.clearSecrets.filter((item) => item !== field),
    }));
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !submit.pending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={motionPrefs.snappy}
          />
        </Dialog.Overlay>
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            role="dialog"
            className="fixed top-1/2 left-1/2 z-50 grid max-h-[min(100%-2rem,44rem)] w-[min(100%-2rem,36rem)] min-w-0 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg outline-none"
            initial={{ opacity: 0, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, x: "-50%", y: "-50%" }}
            transition={motionPrefs.snappy}
          >
            <div className="grid min-w-0 gap-1">
              <Dialog.Title className="text-lg font-medium">
                {channel ? t("channel_edit_title") : t("channel_add_title")}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {t("channel_form_intro")}
              </Dialog.Description>
            </div>
            <form
              className="grid min-w-0 gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const nextErrors = channelFieldErrors(draft, savedSecrets);
                setErrors(nextErrors);
                if (Object.keys(nextErrors).length > 0) return;
                setFormError("");
                void submit.run(async () => {
                  try {
                    await api(
                      channel ? `/api/channels/${channel.id}` : "/api/channels",
                      {
                        method: channel ? "PATCH" : "POST",
                        body: JSON.stringify(channelPayload(draft)),
                      },
                    );
                    await onSaved();
                    onClose();
                  } catch (cause) {
                    setFormError(errorText(cause));
                  }
                });
              }}
            >
              <Field
                label={t("channel_name")}
                hint={t("channel_name_hint")}
                error={errorTextFor(errors.name, "name")}
              >
                <Input
                  name="channelName"
                  value={draft.name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(event) => patch({ name: event.target.value })}
                  required
                />
              </Field>
              <ChannelTypePicker
                value={draft.type}
                onChange={(type) => patch({ type, clearSecrets: [] })}
              />
              <ChannelFields
                draft={draft}
                errors={errors}
                savedSecrets={savedSecrets}
                onChange={patch}
                onClear={setClear}
              />
              {formError ? (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={submit.pending}
                  onClick={onClose}
                >
                  {t("action_cancel")}
                </Button>
                <PendingButton type="submit" pending={submit.pending}>
                  {t("action_save")}
                </PendingButton>
              </div>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function errorTextFor(
  code: ChannelErrorCode | undefined,
  field: ChannelField,
): string | undefined {
  if (!code) return undefined;
  if (field === "headers") return t("channel_headers_invalid");
  if (code === "blocked") return t("channel_field_blocked");
  if (code === "required") return t("channel_field_required");
  return t("channel_field_invalid");
}

function ChannelFields({
  draft,
  errors,
  savedSecrets,
  onChange,
  onClear,
}: {
  draft: ChannelDraft;
  errors: Partial<Record<ChannelField, ChannelErrorCode>>;
  savedSecrets: readonly string[];
  onChange: (next: Partial<ChannelDraft>) => void;
  onClear: (field: string, checked: boolean) => void;
}) {
  switch (draft.type) {
    case "email":
      return (
        <TextField
          label={t("channel_email_to")}
          hint={t("channel_email_to_hint")}
          error={errorTextFor(errors.to, "to")}
          type="email"
          value={draft.to}
          onChange={(to) => onChange({ to })}
        />
      );
    case "discord":
      return (
        <SecretField
          label={t("channel_discord_url")}
          hint={t("channel_discord_url_hint")}
          error={errorTextFor(errors.discordUrl, "discordUrl")}
          value={draft.discordUrl}
          saved={savedSecrets.includes("webhookUrl")}
          onChange={(discordUrl) => onChange({ discordUrl })}
        />
      );
    case "slack":
      return (
        <SecretField
          label={t("channel_slack_url")}
          hint={t("channel_slack_url_hint")}
          error={errorTextFor(errors.slackUrl, "slackUrl")}
          value={draft.slackUrl}
          saved={savedSecrets.includes("webhookUrl")}
          onChange={(slackUrl) => onChange({ slackUrl })}
        />
      );
    case "telegram":
      return (
        <>
          <SecretField
            label={t("channel_telegram_token")}
            hint={t("channel_telegram_token_hint")}
            error={errorTextFor(errors.botToken, "botToken")}
            value={draft.botToken}
            saved={savedSecrets.includes("botToken")}
            onChange={(botToken) => onChange({ botToken })}
          />
          <TextField
            label={t("channel_telegram_chat")}
            hint={t("channel_telegram_chat_hint")}
            error={errorTextFor(errors.chatId, "chatId")}
            value={draft.chatId}
            onChange={(chatId) => onChange({ chatId })}
          />
        </>
      );
    case "webhook":
      return (
        <>
          <SecretField
            label={t("channel_webhook_url")}
            hint={t("channel_webhook_url_hint")}
            error={errorTextFor(errors.webhookUrl, "webhookUrl")}
            value={draft.webhookUrl}
            saved={savedSecrets.includes("url")}
            onChange={(webhookUrl) => onChange({ webhookUrl })}
          />
          <HeaderFields
            draft={draft}
            error={errorTextFor(errors.headers, "headers")}
            saved={savedSecrets.includes("headers")}
            cleared={draft.clearSecrets.includes("headers")}
            onChange={onChange}
            onClear={onClear}
          />
        </>
      );
    case "ntfy":
      return (
        <>
          <TextField
            label={t("channel_ntfy_server")}
            hint={t("channel_ntfy_server_hint")}
            error={errorTextFor(errors.ntfyServer, "ntfyServer")}
            value={draft.ntfyServer}
            onChange={(ntfyServer) => onChange({ ntfyServer })}
          />
          <TextField
            label={t("channel_ntfy_topic")}
            hint={t("channel_ntfy_topic_hint")}
            error={errorTextFor(errors.ntfyTopic, "ntfyTopic")}
            value={draft.ntfyTopic}
            onChange={(ntfyTopic) => onChange({ ntfyTopic })}
          />
          <SecretField
            label={t("channel_ntfy_token")}
            hint={t("channel_ntfy_token_hint")}
            error={errorTextFor(errors.ntfyToken, "ntfyToken")}
            value={draft.ntfyToken}
            saved={savedSecrets.includes("token")}
            optional
            cleared={draft.clearSecrets.includes("token")}
            onChange={(ntfyToken) => onChange({ ntfyToken })}
            onClear={(checked) => onClear("token", checked)}
          />
          <PriorityField
            label={t("channel_ntfy_priority")}
            hint={t("channel_ntfy_priority_hint")}
            error={errorTextFor(errors.ntfyPriority, "ntfyPriority")}
            value={draft.ntfyPriority}
            options={[
              ["1", t("channel_priority_1")],
              ["2", t("channel_priority_2")],
              ["3", t("channel_priority_3")],
              ["4", t("channel_priority_4")],
              ["5", t("channel_priority_5")],
            ]}
            onChange={(ntfyPriority) => onChange({ ntfyPriority })}
          />
          <TextField
            label={t("channel_ntfy_tags")}
            hint={t("channel_ntfy_tags_hint")}
            error={errorTextFor(errors.ntfyTags, "ntfyTags")}
            value={draft.ntfyTags}
            onChange={(ntfyTags) => onChange({ ntfyTags })}
          />
        </>
      );
    case "gotify":
      return (
        <>
          <TextField
            label={t("channel_gotify_server")}
            hint={t("channel_gotify_server_hint")}
            error={errorTextFor(errors.gotifyServer, "gotifyServer")}
            value={draft.gotifyServer}
            onChange={(gotifyServer) => onChange({ gotifyServer })}
          />
          <SecretField
            label={t("channel_gotify_token")}
            hint={t("channel_gotify_token_hint")}
            error={errorTextFor(errors.gotifyToken, "gotifyToken")}
            value={draft.gotifyToken}
            saved={savedSecrets.includes("token")}
            onChange={(gotifyToken) => onChange({ gotifyToken })}
          />
          <TextField
            label={t("channel_gotify_priority")}
            hint={t("channel_gotify_priority_hint")}
            error={errorTextFor(errors.gotifyPriority, "gotifyPriority")}
            type="number"
            value={draft.gotifyPriority}
            onChange={(gotifyPriority) => onChange({ gotifyPriority })}
          />
        </>
      );
    case "pushover":
      return (
        <>
          <SecretField
            label={t("channel_pushover_user")}
            hint={t("channel_pushover_user_hint")}
            error={errorTextFor(errors.pushoverUser, "pushoverUser")}
            value={draft.pushoverUser}
            saved={savedSecrets.includes("userKey")}
            onChange={(pushoverUser) => onChange({ pushoverUser })}
          />
          <SecretField
            label={t("channel_pushover_token")}
            hint={t("channel_pushover_token_hint")}
            error={errorTextFor(errors.pushoverToken, "pushoverToken")}
            value={draft.pushoverToken}
            saved={savedSecrets.includes("appToken")}
            onChange={(pushoverToken) => onChange({ pushoverToken })}
          />
          <TextField
            label={t("channel_pushover_device")}
            hint={t("channel_pushover_device_hint")}
            error={errorTextFor(errors.pushoverDevice, "pushoverDevice")}
            value={draft.pushoverDevice}
            onChange={(pushoverDevice) => onChange({ pushoverDevice })}
          />
          <PriorityField
            label={t("channel_pushover_priority")}
            hint={t("channel_pushover_priority_hint")}
            error={errorTextFor(errors.pushoverPriority, "pushoverPriority")}
            value={draft.pushoverPriority}
            options={[
              ["-2", t("channel_pushover_p_lowest")],
              ["-1", t("channel_pushover_p_low")],
              ["0", t("channel_pushover_p_normal")],
              ["1", t("channel_pushover_p_high")],
              ["2", t("channel_pushover_p_emergency")],
            ]}
            onChange={(pushoverPriority) => onChange({ pushoverPriority })}
          />
          <TextField
            label={t("channel_pushover_sound")}
            hint={t("channel_pushover_sound_hint")}
            error={errorTextFor(errors.pushoverSound, "pushoverSound")}
            value={draft.pushoverSound}
            onChange={(pushoverSound) => onChange({ pushoverSound })}
          />
        </>
      );
    case "teams":
      return (
        <SecretField
          label={t("channel_teams_url")}
          hint={t("channel_teams_url_hint")}
          error={errorTextFor(errors.teamsUrl, "teamsUrl")}
          value={draft.teamsUrl}
          saved={savedSecrets.includes("webhookUrl")}
          onChange={(teamsUrl) => onChange({ teamsUrl })}
        />
      );
    case "google_chat":
      return (
        <SecretField
          label={t("channel_google_chat_url")}
          hint={t("channel_google_chat_url_hint")}
          error={errorTextFor(errors.googleChatUrl, "googleChatUrl")}
          value={draft.googleChatUrl}
          saved={savedSecrets.includes("webhookUrl")}
          onChange={(googleChatUrl) => onChange({ googleChatUrl })}
        />
      );
    case "matrix":
      return (
        <>
          <TextField
            label={t("channel_matrix_homeserver")}
            hint={t("channel_matrix_homeserver_hint")}
            error={errorTextFor(errors.matrixServer, "matrixServer")}
            value={draft.matrixServer}
            onChange={(matrixServer) => onChange({ matrixServer })}
          />
          <SecretField
            label={t("channel_matrix_token")}
            hint={t("channel_matrix_token_hint")}
            error={errorTextFor(errors.matrixToken, "matrixToken")}
            value={draft.matrixToken}
            saved={savedSecrets.includes("accessToken")}
            onChange={(matrixToken) => onChange({ matrixToken })}
          />
          <TextField
            label={t("channel_matrix_room")}
            hint={t("channel_matrix_room_hint")}
            error={errorTextFor(errors.matrixRoom, "matrixRoom")}
            value={draft.matrixRoom}
            onChange={(matrixRoom) => onChange({ matrixRoom })}
          />
        </>
      );
  }
}

function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  hint: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "number";
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Input
        type={type}
        value={value}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function SecretField({
  label,
  hint,
  error,
  value,
  saved,
  optional = false,
  cleared = false,
  onChange,
  onClear,
}: {
  label: string;
  hint: string;
  error?: string;
  value: string;
  saved: boolean;
  optional?: boolean;
  cleared?: boolean;
  onChange: (value: string) => void;
  onClear?: (checked: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Field label={label} hint={hint} error={error}>
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      {saved && !cleared ? (
        <p className="text-xs text-muted-foreground">
          {t("channel_secret_keep")}
        </p>
      ) : null}
      {saved && optional && onClear ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 shrink-0"
            checked={cleared}
            onChange={(event) => onClear(event.target.checked)}
          />
          {t("channel_secret_clear")}
        </label>
      ) : null}
      {cleared ? (
        <p className="text-xs text-muted-foreground">
          {t("channel_secret_cleared")}
        </p>
      ) : null}
    </div>
  );
}

function PriorityField({
  label,
  hint,
  error,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  error?: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select
        className={controlClass}
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("channel_priority_auto")}</option>
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {optionLabel}
          </option>
        ))}
      </select>
    </Field>
  );
}

function HeaderFields({
  draft,
  error,
  saved,
  cleared,
  onChange,
  onClear,
}: {
  draft: ChannelDraft;
  error?: string;
  saved: boolean;
  cleared: boolean;
  onChange: (next: Partial<ChannelDraft>) => void;
  onClear: (field: string, checked: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Field
        label={t("channel_webhook_headers")}
        hint={t("channel_webhook_headers_hint")}
        error={error}
      >
        <span className="sr-only">{t("channel_webhook_headers")}</span>
      </Field>
      {draft.headers.map((header, index) => (
        <div key={header.id} className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Input
            value={header.name}
            aria-label={t("channel_header_name")}
            placeholder={t("channel_header_name")}
            onChange={(event) => {
              const headers = draft.headers.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, name: event.target.value }
                  : item,
              );
              onChange({ headers });
            }}
          />
          <Input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={header.value}
            aria-label={t("channel_header_value")}
            placeholder={t("channel_header_value")}
            onChange={(event) => {
              const headers = draft.headers.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, value: event.target.value }
                  : item,
              );
              onChange({ headers });
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="sm:col-span-2"
            onClick={() =>
              onChange({
                headers: draft.headers.filter(
                  (_, itemIndex) => itemIndex !== index,
                ),
              })
            }
          >
            {t("channel_header_remove")}
          </Button>
        </div>
      ))}
      {saved ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 shrink-0"
            checked={cleared}
            onChange={(event) => onClear("headers", event.target.checked)}
          />
          {t("channel_secret_clear")}
        </label>
      ) : null}
      {cleared ? (
        <p className="text-xs text-muted-foreground">
          {t("channel_secret_cleared")}
        </p>
      ) : null}
      {saved && !cleared ? (
        <p className="text-xs text-muted-foreground">
          {t("channel_secret_keep")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={draft.headers.length >= 10}
        onClick={() =>
          onChange({
            headers: [
              ...draft.headers,
              { id: crypto.randomUUID(), name: "", value: "" },
            ],
          })
        }
      >
        {t("channel_header_add")}
      </Button>
    </div>
  );
}
