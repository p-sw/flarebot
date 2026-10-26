// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { t, textLang } from "@shared/copy";
import { can } from "@shared/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api, errorText } from "../lib/api";
import { type ChannelRecord, channelsQuery } from "../lib/queries";
import { refreshQueries } from "../lib/query-sync";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Stagger, StaggerItem } from "../motion/page";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { ContentSkeleton } from "../ui/skeleton";
import { ChannelGlyph, channelTypeLabel } from "./channel-catalog";
import { ChannelFormDialog } from "./channel-form";
import { Field } from "./fields";

const consoleRoute = getRouteApi("/console");

type Editor = { mode: "create" } | { mode: "edit"; channel: ChannelRecord };

export function ChannelsPage() {
  const { user } = consoleRoute.useRouteContext();
  const writable = can({ role: user.role }, "channels.write");
  const channels = useQuery(channelsQuery);
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<ChannelRecord | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const remove = useSubmitGuard();
  const test = useSubmitGuard();
  const rows = channels.data?.channels ?? [];
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...rows]
      .sort((a, b) => a.name.localeCompare(b.name, textLang))
      .filter((channel) => {
        if (!needle) return true;
        const haystack = [
          channel.name,
          channelTypeLabel(channel.type),
          channel.destination ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
  }, [rows, query]);

  async function saved() {
    setNotice({ tone: "ok", text: t("channel_saved") });
    await refreshQueries(client, [["channels"]]);
  }

  return (
    <>
      <AppHeader
        title={t("nav_channels")}
        actions={
          writable ? (
            <Button type="button" onClick={() => setEditor({ mode: "create" })}>
              {t("channel_new")}
            </Button>
          ) : null
        }
      />
      {writable ? null : (
        <p className="mb-4 text-sm text-muted-foreground">
          {t("channel_readonly_hint")}
        </p>
      )}
      {notice ? (
        <p
          className={`mb-4 text-sm ${notice.tone === "error" ? "text-destructive" : ""}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {channels.isPending ? <ContentSkeleton /> : null}
      {!channels.isPending && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("channel_list_empty")}
        </p>
      ) : null}
      {rows.length > 6 ? (
        <div className="mb-4 max-w-xl">
          <Field label={t("channel_search")} hint={t("channel_search_hint")}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
      ) : null}
      {!channels.isPending && rows.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("channel_search_none")}
        </p>
      ) : null}
      <Stagger className="grid gap-3">
        {visible.map((channel) => (
          <StaggerItem key={channel.id}>
            <article className="min-w-0 rounded-lg border border-border bg-card p-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ChannelGlyph type={channel.type} />
                </span>
                <div className="min-w-0">
                  <p className="break-words font-medium">{channel.name}</p>
                  <p className="text-sm break-all text-muted-foreground">
                    {channelTypeLabel(channel.type)}
                    {channel.destination ? ` · ${channel.destination}` : ""}
                  </p>
                </div>
              </div>
              {writable ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditor({ mode: "edit", channel })}
                  >
                    {t("action_edit")}
                  </Button>
                  <PendingButton
                    type="button"
                    size="sm"
                    variant="outline"
                    pending={testingId === channel.id}
                    disabled={test.pending && testingId !== channel.id}
                    onClick={() => {
                      void test.run(async () => {
                        setTestingId(channel.id);
                        try {
                          await api(`/api/channels/${channel.id}/test`, {
                            method: "POST",
                          });
                          setNotice({
                            tone: "ok",
                            text: t("channel_test_sent", {
                              name: channel.name,
                            }),
                          });
                        } catch (cause) {
                          setNotice({ tone: "error", text: errorText(cause) });
                        } finally {
                          setTestingId(null);
                        }
                      });
                    }}
                  >
                    {t("action_test")}
                  </PendingButton>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setRemoving(channel)}
                  >
                    {t("action_delete")}
                  </Button>
                </div>
              ) : null}
            </article>
          </StaggerItem>
        ))}
      </Stagger>
      {editor ? (
        <ChannelFormDialog
          key={editor.mode === "edit" ? editor.channel.id : "create"}
          channel={editor.mode === "edit" ? editor.channel : undefined}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("action_delete")}
        description={t("channel_delete_confirm")}
        confirmLabel={t("action_delete")}
        cancelLabel={t("action_cancel")}
        pending={remove.pending}
        onConfirm={() => {
          if (!removing) return;
          const id = removing.id;
          void remove.run(async () => {
            try {
              await api(`/api/channels/${id}`, { method: "DELETE" });
              setRemoving(null);
              setNotice({ tone: "ok", text: t("channel_deleted") });
              await refreshQueries(client, [["channels"]]);
            } catch (cause) {
              setNotice({ tone: "error", text: errorText(cause) });
            }
          });
        }}
      />
    </>
  );
}

export function ChannelAttachList({
  channels,
  selected,
  onChange,
}: {
  channels: { id: string; name: string; type: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = channels.filter((channel) => {
    if (!needle) return true;
    return `${channel.name} ${channelTypeLabel(channel.type)}`
      .toLowerCase()
      .includes(needle);
  });
  return (
    <div className="grid min-w-0 gap-3">
      {channels.length > 6 ? (
        <Field
          label={t("monitor_channels_search")}
          hint={t("channel_search_hint")}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("monitor_channels_search_none")}
        </p>
      ) : (
        <ul className="grid min-w-0 gap-2">
          {visible.map((channel) => (
            <li key={channel.id}>
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={selected.includes(channel.id)}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...selected, channel.id]
                        : selected.filter((id) => id !== channel.id),
                    );
                  }}
                />
                <ChannelGlyph type={channel.type} className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {channel.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {channelTypeLabel(channel.type)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
