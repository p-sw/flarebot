// SPDX-License-Identifier: MIT

import * as Dialog from "@radix-ui/react-dialog";
import { t } from "@shared/copy";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, api } from "../lib/api";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { useMotionPrefs } from "../motion/page";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { Switch } from "../ui/switch";

export type PublicSubscriptions = {
  email: boolean;
  webhook: boolean;
  rss: boolean;
  turnstileSiteKey: string | null;
  components: { id: string; name: string }[];
};

type SubscribeResult = {
  ok: boolean;
  kind: "email" | "webhook";
  pending?: boolean;
  secret?: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

export function SubscribeEntry({
  slug,
  subscriptions,
}: {
  slug: string;
  subscriptions: PublicSubscriptions;
}) {
  const [open, setOpen] = useState(false);
  const feedBase = slug ? `/s/${slug}` : "";
  return (
    <div className="mt-6 flex min-w-0 flex-wrap items-center gap-3">
      {subscriptions.email || subscriptions.webhook ? (
        <>
          <Button type="button" onClick={() => setOpen(true)}>
            {t("subscribe_open")}
          </Button>
          <SubscribeDialog
            slug={slug}
            subscriptions={subscriptions}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      ) : null}
      {subscriptions.rss ? (
        <>
          <a
            className="text-sm underline-offset-2 hover:underline"
            href={`${feedBase}/feed.rss`}
          >
            {t("subscribe_feed_rss")}
          </a>
          <a
            className="text-sm underline-offset-2 hover:underline"
            href={`${feedBase}/feed.atom`}
          >
            {t("subscribe_feed_atom")}
          </a>
        </>
      ) : null}
    </div>
  );
}

function SubscribeDialog({
  slug,
  subscriptions,
  open,
  onOpenChange,
}: {
  slug: string;
  subscriptions: PublicSubscriptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const motionPrefs = useMotionPrefs();
  const submit = useSubmitGuard();
  const client = useQueryClient();
  const widget = useRef<HTMLDivElement>(null);
  const initialKind = subscriptions.email ? "email" : "webhook";
  const [kind, setKind] = useState<"email" | "webhook">(initialKind);
  const [email, setEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [followAll, setFollowAll] = useState(true);
  const [monitorIds, setMonitorIds] = useState<string[]>([]);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !subscriptions.turnstileSiteKey || !widget.current) return;
    const siteKey = subscriptions.turnstileSiteKey;
    const node = widget.current;
    let widgetId = "";
    function render() {
      if (!window.turnstile || !node) return;
      widgetId = window.turnstile.render(node, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token),
      });
    }
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => render();
    document.body.appendChild(script);
    return () => {
      script.remove();
      void widgetId;
    };
  }, [open, subscriptions.turnstileSiteKey]);

  function toggleMonitor(id: string, checked: boolean) {
    setMonitorIds((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    );
  }

  async function send() {
    setError("");
    setNotice("");
    if (subscriptions.turnstileSiteKey && !turnstileToken) {
      setError(t("error_turnstile_required"));
      return;
    }
    await submit.run(async () => {
      try {
        const result = await api<SubscribeResult>("/api/public/subscribe", {
          method: "POST",
          body: JSON.stringify({
            slug,
            kind,
            email: kind === "email" ? email : undefined,
            webhookUrl: kind === "webhook" ? webhookUrl : undefined,
            followAll,
            monitorIds: followAll ? [] : monitorIds,
            turnstileToken: turnstileToken || undefined,
          }),
        });
        if (result.kind === "webhook" && result.secret) {
          setSecret(result.secret);
          setNotice(t("subscribe_webhook_saved"));
        } else {
          setNotice(t("subscribe_email_sent"));
        }
        await client.invalidateQueries({ queryKey: ["public"] });
      } catch (cause) {
        setError(
          cause instanceof ApiClientError ? cause.message : t("error_generic"),
        );
      }
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => !submit.pending && onOpenChange(next)}
    >
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={motionPrefs.snappy}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                role="dialog"
                aria-labelledby="subscribe-title"
                className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(100%-1.5rem,32rem)] overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none"
                initial={
                  motionPrefs.still
                    ? { opacity: 0, x: "-50%", y: "-50%" }
                    : { opacity: 0, x: "-50%", y: "calc(-50% + 8px)" }
                }
                animate={{ opacity: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, x: "-50%", y: "-50%" }}
                transition={motionPrefs.snappy}
              >
                <Dialog.Title
                  id="subscribe-title"
                  className="text-lg font-medium"
                >
                  {t("subscribe_title")}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                  {t("subscribe_intro")}
                </Dialog.Description>
                <form
                  className="mt-4 grid min-w-0 gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  {subscriptions.email && subscriptions.webhook ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={kind === "email" ? "default" : "outline"}
                        onClick={() => setKind("email")}
                      >
                        {t("subscribe_email")}
                      </Button>
                      <Button
                        type="button"
                        variant={kind === "webhook" ? "default" : "outline"}
                        onClick={() => setKind("webhook")}
                      >
                        {t("subscribe_webhook")}
                      </Button>
                    </div>
                  ) : null}
                  {kind === "email" ? (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Input is the control
                    <label className="grid min-w-0 gap-1.5 text-sm">
                      <span className="font-medium">
                        {t("subscribe_email_label")}
                      </span>
                      <Input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {t("subscribe_email_hint")}
                      </span>
                    </label>
                  ) : (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Input is the control
                    <label className="grid min-w-0 gap-1.5 text-sm">
                      <span className="font-medium">
                        {t("subscribe_url_label")}
                      </span>
                      <Input
                        name="webhookUrl"
                        type="url"
                        required
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {t("subscribe_url_hint")}
                      </span>
                    </label>
                  )}
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
                  <label className="flex min-w-0 items-start gap-3 text-sm">
                    <Switch
                      checked={followAll}
                      aria-labelledby="subscribe-all"
                      onCheckedChange={setFollowAll}
                    />
                    <span className="grid gap-1">
                      <span id="subscribe-all" className="font-medium">
                        {t("subscribe_all")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("subscribe_all_hint")}
                      </span>
                    </span>
                  </label>
                  {followAll ? null : (
                    <fieldset className="grid min-w-0 gap-2">
                      <legend className="text-xs text-muted-foreground">
                        {t("subscribe_components_hint")}
                      </legend>
                      {subscriptions.components.map((component) => (
                        <label
                          key={component.id}
                          className="flex min-w-0 items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={monitorIds.includes(component.id)}
                            onChange={(event) =>
                              toggleMonitor(component.id, event.target.checked)
                            }
                          />
                          <span className="min-w-0 break-words">
                            {component.name}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {subscriptions.turnstileSiteKey ? (
                    <div ref={widget} className="min-h-16 min-w-0" />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("subscribe_rate_note")}
                    </p>
                  )}
                  {error ? (
                    <p
                      role="alert"
                      className="text-sm break-words text-destructive"
                    >
                      {error}
                    </p>
                  ) : null}
                  {notice ? (
                    <p role="status" className="text-sm break-words">
                      {notice}
                    </p>
                  ) : null}
                  {secret ? (
                    <div className="grid min-w-0 gap-1">
                      <span className="text-sm font-medium">
                        {t("subscribe_secret_once")}
                      </span>
                      <code className="block max-w-full overflow-x-auto rounded-lg bg-muted px-2 py-1 text-xs break-all">
                        {secret}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        {t("subscribe_secret_hint")}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(secret)
                            .then(() => {
                              setCopied(true);
                            });
                        }}
                      >
                        {copied ? t("subscribe_copied") : t("subscribe_copy")}
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Dialog.Close asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={submit.pending}
                      >
                        {t("subscribe_close")}
                      </Button>
                    </Dialog.Close>
                    <PendingButton type="submit" pending={submit.pending}>
                      {t("subscribe_submit")}
                    </PendingButton>
                  </div>
                </form>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
