// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ApiClientError, api } from "../lib/api";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Button } from "../ui/button";
import { PendingButton } from "../ui/pending-button";
import { ContentSkeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";

type ManageView = {
  pageTitle: string;
  slug: string;
  kind: string;
  email: string | null;
  status: string;
  followAll: boolean;
  monitorIds: string[];
  components: { id: string; name: string }[];
};

export function SubscribeManagePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const view = useQuery({
    queryKey: ["subscribe-manage", token],
    queryFn: () => api<ManageView>(`/api/public/subscribe/manage/${token}`),
  });
  if (view.isPending) return <ContentSkeleton />;
  if (view.isError || !view.data) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-xl font-medium">
          {t("subscribe_token_invalid_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("subscribe_token_invalid_body")}
        </p>
      </main>
    );
  }
  return <ManageForm token={token} initial={view.data} />;
}

function ManageForm({
  token,
  initial,
}: {
  token: string;
  initial: ManageView;
}) {
  const client = useQueryClient();
  const save = useSubmitGuard();
  const remove = useSubmitGuard();
  const [followAll, setFollowAll] = useState(initial.followAll);
  const [monitorIds, setMonitorIds] = useState(initial.monitorIds);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busy = save.pending || remove.pending;

  async function persist() {
    setError("");
    setNotice("");
    await save.run(async () => {
      try {
        const next = await api<{ followAll: boolean; monitorIds: string[] }>(
          `/api/public/subscribe/manage/${token}`,
          {
            method: "PUT",
            body: JSON.stringify({
              followAll,
              monitorIds: followAll ? [] : monitorIds,
            }),
          },
        );
        setFollowAll(next.followAll);
        setMonitorIds(next.monitorIds);
        setNotice(t("subscribe_saved"));
        await client.invalidateQueries({
          queryKey: ["subscribe-manage", token],
        });
      } catch (cause) {
        setError(
          cause instanceof ApiClientError ? cause.message : t("error_generic"),
        );
      }
    });
  }

  async function unsubscribe() {
    setError("");
    await remove.run(async () => {
      try {
        await api(`/api/public/subscribe/unsubscribe/${token}`, {
          method: "POST",
        });
        setNotice(t("subscribe_unsubscribed"));
      } catch (cause) {
        setError(
          cause instanceof ApiClientError ? cause.message : t("error_generic"),
        );
      }
    });
  }

  return (
    <main className="mx-auto min-w-0 max-w-lg px-4 py-16">
      <h1 className="text-xl font-medium">{t("subscribe_manage_title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("subscribe_manage_intro", { page: initial.pageTitle })}
      </p>
      {initial.email ? (
        <p className="mt-3 text-sm break-all">{initial.email}</p>
      ) : null}
      <form
        className="mt-6 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void persist();
        }}
      >
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={followAll}
            disabled={busy}
            onCheckedChange={setFollowAll}
          />
          <span className="grid gap-1">
            <span className="font-medium">{t("subscribe_all")}</span>
            <span className="text-xs text-muted-foreground">
              {t("subscribe_all_hint")}
            </span>
          </span>
        </label>
        {followAll ? null : (
          <fieldset className="grid gap-2">
            <legend className="text-xs text-muted-foreground">
              {t("subscribe_components_hint")}
            </legend>
            {initial.components.map((component) => (
              <label
                key={component.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={monitorIds.includes(component.id)}
                  disabled={busy}
                  onChange={(event) => {
                    setMonitorIds((current) =>
                      event.target.checked
                        ? [...current, component.id]
                        : current.filter((id) => id !== component.id),
                    );
                  }}
                />
                <span className="min-w-0 break-words">{component.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <PendingButton
            type="submit"
            pending={save.pending}
            disabled={remove.pending}
          >
            {t("action_save")}
          </PendingButton>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void unsubscribe()}
          >
            {remove.pending ? t("action_working") : t("subscribe_unsubscribe")}
          </Button>
          <a
            className="inline-flex h-10 items-center text-sm"
            href={`/s/${initial.slug}`}
          >
            {t("subscribe_back_status")}
          </a>
        </div>
      </form>
    </main>
  );
}
