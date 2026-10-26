// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api, errorText } from "../lib/api";
import { settingsQuery } from "../lib/queries";
import { refreshQueries } from "../lib/query-sync";
import { useToggleLock } from "../lib/toggle-guard";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { Switch } from "../ui/switch";
import { Field } from "./fields";

export function SubscribeSettings() {
  const settings = useQuery(settingsQuery);
  const client = useQueryClient();
  const save = useSubmitGuard();
  const toggles = useToggleLock();
  const data = settings.data;
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [note, setNote] = useState("");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [allowHttp, setAllowHttp] = useState<boolean | null>(null);
  const [httpError, setHttpError] = useState("");
  if (!data) return null;
  const shownKey = siteKey ?? data.subscribeTurnstile.siteKey;
  const shownHttp = allowHttp ?? data.subscribeAllowHttp;

  return (
    <section className="mb-8 max-w-xl">
      <h2 className="mb-3 font-medium">{t("settings_turnstile")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("settings_turnstile_intro")}
      </p>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run(async () => {
            try {
              await api("/api/settings", {
                method: "PUT",
                body: JSON.stringify({
                  turnstileSiteKey: shownKey,
                  turnstileSecret: secret,
                  clearTurnstileSecret: clearSecret,
                }),
              });
              setSecret("");
              setClearSecret(false);
              setSiteKey(null);
              setTone("ok");
              setNote(t("saved"));
              await refreshQueries(client, [["settings"]]);
            } catch (cause) {
              setTone("error");
              setNote(errorText(cause));
            }
          });
        }}
      >
        <Field
          label={t("settings_turnstile_site")}
          hint={t("settings_turnstile_site_hint")}
        >
          <Input
            name="turnstileSiteKey"
            value={shownKey}
            autoComplete="off"
            disabled={save.pending}
            onChange={(event) => setSiteKey(event.target.value)}
          />
        </Field>
        <Field
          label={t("settings_turnstile_secret")}
          hint={t("settings_turnstile_secret_hint")}
        >
          <Input
            name="turnstileSecret"
            type="password"
            value={secret}
            autoComplete="new-password"
            disabled={save.pending}
            placeholder={data.subscribeTurnstile.hasSecret ? "••••••••" : ""}
            onChange={(event) => setSecret(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearSecret}
            disabled={save.pending}
            onChange={(event) => setClearSecret(event.target.checked)}
          />
          <span>{t("settings_turnstile_clear")}</span>
        </label>
        <PendingButton type="submit" pending={save.pending}>
          {t("action_save")}
        </PendingButton>
        {note ? (
          <p
            className={`text-sm ${tone === "error" ? "text-destructive" : ""}`}
            role={tone === "error" ? "alert" : "status"}
          >
            {note}
          </p>
        ) : null}
      </form>
      <div className="mt-6 rounded-lg border border-border p-3">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
        <label className="flex min-w-0 items-center gap-3 text-sm">
          <Switch
            checked={shownHttp}
            disabled={toggles.pending}
            aria-labelledby="subscribe-allow-http"
            aria-busy={toggles.pending || undefined}
            onCheckedChange={(checked) => {
              setHttpError("");
              setAllowHttp(checked);
              void toggles.run("http", async () => {
                try {
                  await api("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ subscribeAllowHttp: checked }),
                  });
                  await refreshQueries(client, [["settings"]]);
                  setAllowHttp(null);
                } catch (cause) {
                  setAllowHttp(data.subscribeAllowHttp);
                  setHttpError(errorText(cause));
                }
              });
            }}
          />
          <span id="subscribe-allow-http" className="font-medium">
            {t("settings_subscribe_http")}
          </span>
          {toggles.pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : null}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings_subscribe_http_hint")}
        </p>
        {httpError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {httpError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
