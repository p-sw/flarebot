// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { isSupportedLocale } from "@shared/locales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { Switch } from "@/ui/switch";
import { api, errorText } from "../lib/api";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { PageEnter } from "../motion/page";
import { m } from "../paraglide/messages.js";
import { getLocale, setLocale } from "../paraglide/runtime.js";
import { controlClass, Field } from "./fields";

export function StatusPagesPage() {
  const pages = useQuery({
    queryKey: ["pages"],
    queryFn: () =>
      api<{
        pages: {
          id: string;
          slug: string;
          title: string;
          published: boolean;
          serveAtRoot: boolean;
          missing: number;
          itemCount: number;
        }[];
      }>("/api/status-pages"),
  });
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: () =>
      api<{ monitors: { id: string; name: string }[] }>("/api/monitors"),
  });
  const client = useQueryClient();
  const [title, setTitle] = useState("Status");
  const [slug, setSlug] = useState("status");
  const [monitorId, setMonitorId] = useState("");
  const [error, setError] = useState("");
  const submit = useSubmitGuard();
  const [pendingId, setPendingId] = useState<string | null>(null);
  async function setRoot(id: string, serveAtRoot: boolean) {
    setError("");
    setPendingId(id);
    try {
      await api(`/api/status-pages/${id}/root`, {
        method: "PUT",
        body: JSON.stringify({ serveAtRoot }),
      });
      await client.invalidateQueries({ queryKey: ["pages"] });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPendingId(null);
    }
  }
  return (
    <PageEnter>
      <AppHeader title={m.nav_status_pages()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          void submit.run(async () => {
            try {
              const chosen = monitorId || monitors.data?.monitors[0]?.id;
              await api("/api/status-pages", {
                method: "POST",
                body: JSON.stringify({
                  slug,
                  published: true,
                  defaultLocale: "en",
                  locales: ["en", "ko"],
                  sourceLocale: "en",
                  title,
                  description: "",
                  footer: "",
                  banner: "",
                  i18n: { ko: { title: `${title} KO` } },
                  items: chosen
                    ? [
                        {
                          monitorId: chosen,
                          position: 0,
                          groupName: "Core",
                          displayName: "",
                          sourceLocale: "en",
                          i18n: {},
                        },
                      ]
                    : [],
                }),
              });
              await client.invalidateQueries({ queryKey: ["pages"] });
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      >
        <Field label={m.page_title()}>
          <Input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </Field>
        <Field label={m.page_slug()}>
          <Input
            name="slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
          />
        </Field>
        <Field label={m.page_items()}>
          <select
            className={controlClass}
            name="monitorId"
            value={monitorId}
            onChange={(event) => setMonitorId(event.target.value)}
          >
            <option value="">{m.action_add()}</option>
            {monitors.data?.monitors.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <PendingButton type="submit" pending={submit.pending}>
          {m.page_new()}
        </PendingButton>
      </form>
      <div className="grid gap-3">
        {pages.data?.pages.map((page) => (
          <article
            key={page.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{page.title}</p>
                <p className="text-sm break-all text-muted-foreground">
                  /s/{page.slug} · {m.missing_count({ count: page.missing })}
                </p>
              </div>
              <a className="text-sm" href={`/s/${page.slug}`}>
                {m.page_public_link()}
              </a>
            </div>
            <div className="mt-4 grid gap-2 border-t border-border pt-4">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={page.serveAtRoot}
                  disabled={
                    pendingId !== null || (!page.published && !page.serveAtRoot)
                  }
                  onCheckedChange={(checked) => void setRoot(page.id, checked)}
                />
                <span>{m.page_root_label()}</span>
              </label>
              <p className="text-sm text-muted-foreground">
                {m.page_root_note({ slug: page.slug })}
              </p>
              {page.serveAtRoot ? (
                <p className="text-sm">{m.page_root_current()}</p>
              ) : null}
              {page.published ? null : (
                <p className="text-sm text-muted-foreground">
                  {m.page_root_unpublished()}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </PageEnter>
  );
}

export function ChannelsPage() {
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () =>
      api<{ channels: { id: string; name: string; type: string }[] }>(
        "/api/channels",
      ),
  });
  const client = useQueryClient();
  const [name, setName] = useState("Ops email");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const submit = useSubmitGuard();
  const test = useSubmitGuard();
  return (
    <PageEnter>
      <AppHeader title={m.nav_channels()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run(async () => {
            await api("/api/channels", {
              method: "POST",
              body: JSON.stringify({ name, type: "email", config: { to } }),
            });
            await client.invalidateQueries({ queryKey: ["channels"] });
          });
        }}
      >
        <Field label={m.channel_name()}>
          <Input
            name="channelName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label={m.channel_email_to()}>
          <Input
            name="to"
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          />
        </Field>
        <PendingButton type="submit" pending={submit.pending}>
          {m.channel_new()}
        </PendingButton>
      </form>
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      <div className="grid gap-2">
        {channels.data?.channels.map((channel) => (
          <div
            key={channel.id}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
          >
            <span>
              {channel.name} · {channel.type}
            </span>
            <PendingButton
              size="sm"
              variant="outline"
              type="button"
              pending={test.pending}
              onClick={() => {
                void test.run(async () => {
                  try {
                    await api(`/api/channels/${channel.id}/test`, {
                      method: "POST",
                    });
                    setMessage(m.channel_test_sent());
                  } catch (cause) {
                    setMessage(errorText(cause));
                  }
                });
              }}
            >
              {m.action_test()}
            </PendingButton>
          </div>
        ))}
      </div>
    </PageEnter>
  );
}

export function TeamPage() {
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () =>
      api<{
        members: { id: string; name: string; email: string; role: string }[];
      }>("/api/team"),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [link, setLink] = useState("");
  const submit = useSubmitGuard();
  return (
    <PageEnter>
      <AppHeader title={m.nav_team()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run(async () => {
            const created = await api<{ link: string }>("/api/team/invites", {
              method: "POST",
              body: JSON.stringify({ email: email || undefined, role }),
            });
            setLink(created.link);
          });
        }}
      >
        <Field label={m.team_email_optional()}>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label={m.team_role()}>
          <select
            className={controlClass}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="admin">{m.role_admin()}</option>
            <option value="editor">{m.role_editor()}</option>
            <option value="viewer">{m.role_viewer()}</option>
          </select>
        </Field>
        <PendingButton type="submit" pending={submit.pending}>
          {m.team_invite()}
        </PendingButton>
      </form>
      {link ? <p className="mb-4 break-all font-mono text-xs">{link}</p> : null}
      <div className="grid gap-2">
        {team.data?.members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span>
              {member.name} · {member.email}
            </span>
            <span>{member.role}</span>
          </div>
        ))}
      </div>
    </PageEnter>
  );
}

export function TokensPage() {
  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () =>
      api<{
        tokens: {
          id: string;
          name: string;
          scopes: string[];
          lastUsedAt: number | null;
        }[];
        allowedScopes: string[];
      }>("/api/tokens"),
  });
  const client = useQueryClient();
  const [name, setName] = useState("CI");
  const [raw, setRaw] = useState("");
  const submit = useSubmitGuard();
  const revoke = useSubmitGuard();
  return (
    <PageEnter>
      <AppHeader title={m.nav_tokens()} />
      <form
        className="mb-4 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run(async () => {
            const created = await api<{ token: string }>("/api/tokens", {
              method: "POST",
              body: JSON.stringify({ name, scopes: ["read"] }),
            });
            setRaw(created.token);
            await client.invalidateQueries({ queryKey: ["tokens"] });
          });
        }}
      >
        <Field label={m.token_name()}>
          <Input
            name="tokenName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <PendingButton type="submit" pending={submit.pending}>
          {m.token_new()}
        </PendingButton>
      </form>
      {raw ? (
        <p className="mb-4 break-all rounded-lg bg-muted p-3 font-mono text-xs">
          {m.token_once()} {raw}
        </p>
      ) : null}
      <div className="grid gap-2">
        {tokens.data?.tokens.map((token) => (
          <div
            key={token.id}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span>
              {token.name} · {token.scopes.join(", ")}
            </span>
            <PendingButton
              size="sm"
              variant="outline"
              type="button"
              pending={revoke.pending}
              onClick={() => {
                void revoke.run(async () => {
                  await api(`/api/tokens/${token.id}`, { method: "DELETE" });
                  await client.invalidateQueries({ queryKey: ["tokens"] });
                });
              }}
            >
              {m.token_revoke()}
            </PendingButton>
          </div>
        ))}
      </div>
    </PageEnter>
  );
}

export function AuditPage() {
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: () =>
      api<{
        events: {
          id: string;
          action: string;
          target: string | null;
          createdAt: number;
        }[];
      }>("/api/audit"),
  });
  return (
    <PageEnter>
      <AppHeader title={m.nav_audit()} />
      {(audit.data?.events.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{m.audit_empty()}</p>
      ) : null}
      <div className="grid gap-2">
        {audit.data?.events.map((event) => (
          <div
            key={event.id}
            className="grid min-w-0 gap-1 rounded-lg border border-border px-3 py-2 text-sm sm:grid-cols-3"
          >
            <span>{new Date(event.createdAt).toISOString()}</span>
            <span>{event.action}</span>
            <span className="truncate text-muted-foreground">
              {event.target}
            </span>
          </div>
        ))}
      </div>
    </PageEnter>
  );
}

type MailDriver = "none" | "smtp" | "cf-email";
type MailSecurity = "starttls" | "tls" | "none";

type MailSettings = {
  driver: string;
  host: string;
  port: number;
  security: string;
  username: string;
  hasPassword: boolean;
  fromName: string;
  fromAddress: string;
  activeSource: "secrets" | "database" | "cloudflare" | "none";
  emailBinding: boolean;
  secretsOverride: boolean;
};

type MailDraft = {
  driver: MailDriver;
  host: string;
  port: 587 | 465;
  security: MailSecurity;
  username: string;
  password: string;
  clearPassword: boolean;
  fromName: string;
  fromAddress: string;
  testTo: string;
};

function asDriver(value: string | undefined): MailDriver {
  if (value === "smtp" || value === "cf-email") return value;
  return "none";
}

function asSecurity(value: string | undefined): MailSecurity {
  if (value === "tls" || value === "none") return value;
  return "starttls";
}

function mailDraft(data: MailSettings | undefined): MailDraft {
  return {
    driver: asDriver(data?.driver),
    host: data?.host ?? "",
    port: data?.port === 465 ? 465 : 587,
    security: asSecurity(data?.security),
    username: data?.username ?? "",
    password: "",
    clearPassword: false,
    fromName: data?.fromName || "Flarebot",
    fromAddress: data?.fromAddress ?? "",
    testTo: "",
  };
}

function mailSourceText(mail: MailSettings | undefined): string {
  if (!mail || mail.activeSource === "none")
    return m.settings_mail_source_none();
  if (mail.activeSource === "secrets") return m.settings_mail_source_secrets();
  if (mail.activeSource === "database")
    return m.settings_mail_source_database();
  return mail.emailBinding
    ? m.settings_mail_source_cloudflare()
    : m.settings_mail_source_cloudflare_unbound();
}

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ instanceName: string; defaultLocale: string; authMode: string }>(
        "/api/settings",
      ),
  });
  const mail = useQuery({
    queryKey: ["mail"],
    queryFn: () => api<MailSettings>("/api/settings/mail"),
  });
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [note, setNote] = useState("");
  const [noteTone, setNoteTone] = useState<"ok" | "error">("ok");
  const client = useQueryClient();
  const saveInstance = useSubmitGuard();
  const saveMail = useSubmitGuard();
  const shownName = name ?? settings.data?.instanceName ?? "";
  const form = draft ?? mailDraft(mail.data);
  const patch = (next: Partial<MailDraft>) => setDraft({ ...form, ...next });

  function report(tone: "ok" | "error", text: string) {
    setNoteTone(tone);
    setNote(text);
  }

  return (
    <PageEnter>
      <AppHeader title={m.nav_settings()} />
      <form
        className="mb-8 grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void saveInstance.run(async () => {
            try {
              await api("/api/settings", {
                method: "PUT",
                body: JSON.stringify({ instanceName: shownName }),
              });
              await client.invalidateQueries({ queryKey: ["settings"] });
              report("ok", m.saved());
            } catch (cause) {
              report("error", errorText(cause));
            }
          });
        }}
      >
        <Field
          label={m.settings_instance_name()}
          hint={m.settings_instance_hint()}
        >
          <Input
            name="instanceName"
            value={shownName}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <PendingButton type="submit" pending={saveInstance.pending}>
          {m.action_save()}
        </PendingButton>
      </form>
      <h2 className="mb-3 font-medium">{m.settings_mail()}</h2>
      <p className="mb-3 max-w-xl text-sm text-muted-foreground">
        {m.settings_mail_intro()}
      </p>
      <p
        className="mb-4 max-w-xl rounded-lg border border-border bg-muted px-3 py-2 text-sm"
        role="status"
      >
        {mailSourceText(mail.data)}
      </p>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mail.data) return;
          void saveMail.run(async () => {
            try {
              const body =
                form.driver === "none"
                  ? { driver: "none" }
                  : form.driver === "cf-email"
                    ? {
                        driver: "cf-email",
                        fromName: form.fromName,
                        fromAddress: form.fromAddress,
                      }
                    : {
                        driver: "smtp",
                        host: form.host,
                        port: form.port,
                        security: form.security,
                        username: form.username,
                        fromName: form.fromName,
                        fromAddress: form.fromAddress,
                        ...(form.clearPassword
                          ? { clearPassword: true }
                          : form.password
                            ? { password: form.password }
                            : {}),
                      };
              await api("/api/settings/mail", {
                method: "PUT",
                body: JSON.stringify(body),
              });
              setDraft({ ...form, password: "", clearPassword: false });
              await client.invalidateQueries({ queryKey: ["mail"] });
              report("ok", m.saved());
            } catch (cause) {
              report("error", errorText(cause));
            }
          });
        }}
      >
        <Field label={m.settings_driver()} hint={m.settings_driver_hint()}>
          <select
            className={controlClass}
            name="driver"
            value={form.driver}
            onChange={(event) =>
              patch({ driver: event.target.value as MailDriver })
            }
          >
            <option value="smtp">{m.settings_driver_smtp()}</option>
            <option value="cf-email">{m.settings_driver_cf()}</option>
            <option value="none">{m.settings_driver_none()}</option>
          </select>
        </Field>
        {form.driver === "smtp" ? (
          <>
            <Field label={m.settings_host()} hint={m.settings_host_hint()}>
              <Input
                name="smtpHost"
                value={form.host}
                onChange={(event) => patch({ host: event.target.value })}
                required
              />
            </Field>
            <Field label={m.settings_port()} hint={m.settings_port_hint()}>
              <select
                className={controlClass}
                name="smtpPort"
                value={form.port}
                onChange={(event) =>
                  patch({
                    port: Number(event.target.value) === 465 ? 465 : 587,
                  })
                }
              >
                <option value={587}>587</option>
                <option value={465}>465</option>
              </select>
            </Field>
            <Field
              label={m.settings_security()}
              hint={m.settings_security_hint()}
            >
              <select
                className={controlClass}
                name="smtpSecurity"
                value={form.security}
                onChange={(event) =>
                  patch({ security: event.target.value as MailSecurity })
                }
              >
                <option value="starttls">
                  {m.settings_security_starttls()}
                </option>
                <option value="tls">{m.settings_security_tls()}</option>
                <option value="none">{m.settings_security_none()}</option>
              </select>
            </Field>
            <Field
              label={m.settings_username()}
              hint={m.settings_username_hint()}
            >
              <Input
                name="smtpUser"
                autoComplete="username"
                value={form.username}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </Field>
            <Field
              label={m.settings_password()}
              hint={m.settings_password_hint()}
            >
              <Input
                name="smtpPassword"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) =>
                  patch({ password: event.target.value, clearPassword: false })
                }
              />
            </Field>
            {mail.data?.hasPassword ? (
              <p className="text-sm">{m.settings_password_set()}</p>
            ) : null}
            {mail.data?.hasPassword ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.clearPassword}
                  onChange={(event) =>
                    patch({
                      clearPassword: event.target.checked,
                      password: event.target.checked ? "" : form.password,
                    })
                  }
                />
                {m.settings_password_clear()}
              </label>
            ) : null}
          </>
        ) : null}
        {form.driver !== "none" ? (
          <>
            <Field
              label={m.settings_from_name()}
              hint={m.settings_from_name_hint()}
            >
              <Input
                name="fromName"
                value={form.fromName}
                onChange={(event) => patch({ fromName: event.target.value })}
                required
              />
            </Field>
            <Field
              label={m.settings_from_address()}
              hint={m.settings_from_address_hint()}
            >
              <Input
                name="from"
                type="email"
                value={form.fromAddress}
                onChange={(event) => patch({ fromAddress: event.target.value })}
                required
              />
            </Field>
          </>
        ) : null}
        <Field label={m.settings_test_to()} hint={m.settings_test_hint()}>
          <Input
            name="testTo"
            type="email"
            value={form.testTo}
            onChange={(event) => patch({ testTo: event.target.value })}
            placeholder={m.settings_test_to_placeholder()}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <PendingButton
            type="submit"
            pending={saveMail.pending}
            disabled={!mail.data}
          >
            {m.action_save()}
          </PendingButton>
          <PendingButton
            type="button"
            variant="outline"
            pending={saveMail.pending}
            disabled={!mail.data}
            onClick={() => {
              void saveMail.run(async () => {
                try {
                  await api("/api/settings/mail/test", {
                    method: "POST",
                    body: JSON.stringify(
                      form.testTo ? { email: form.testTo } : {},
                    ),
                  });
                  report("ok", m.settings_test_ok());
                } catch (cause) {
                  report("error", errorText(cause));
                }
              });
            }}
          >
            {m.action_test()}
          </PendingButton>
        </div>
      </form>
      {note ? (
        <p
          className={`mt-3 text-sm ${noteTone === "error" ? "text-destructive" : ""}`}
          role={noteTone === "error" ? "alert" : "status"}
        >
          {note}
        </p>
      ) : null}
    </PageEnter>
  );
}

export function AccountPage() {
  const account = useQuery({
    queryKey: ["account"],
    queryFn: () =>
      api<{
        name: string;
        email: string;
        locale: string | null;
        totpEnabled: boolean;
        passkeys: { id: string; deviceName: string | null }[];
      }>("/api/account"),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const submit = useSubmitGuard();
  const saved = isSupportedLocale(account.data?.locale ?? "")
    ? account.data?.locale
    : null;
  const locale = draft ?? saved ?? getLocale();
  return (
    <PageEnter>
      <AppHeader title={m.nav_account()} />
      <p className="mb-4 break-all text-sm text-muted-foreground">
        {account.data?.email}
      </p>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSupportedLocale(locale)) return;
          setError("");
          void submit.run(async () => {
            try {
              await api("/api/account", {
                method: "PATCH",
                body: JSON.stringify({ locale }),
              });
              await setLocale(locale);
              window.location.reload();
            } catch (cause) {
              setError(errorText(cause));
            }
          });
        }}
      >
        <Field label={m.account_language()} hint={m.account_language_hint()}>
          <select
            className={controlClass}
            name="accountLocale"
            value={locale}
            onChange={(event) => setDraft(event.target.value)}
          >
            <option value="en">{m.language_en()}</option>
            <option value="ko">{m.language_ko()}</option>
          </select>
        </Field>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <PendingButton type="submit" pending={submit.pending}>
          {m.action_save()}
        </PendingButton>
      </form>
      <h2 className="mt-8 mb-2 font-medium">{m.account_passkeys()}</h2>
      {(account.data?.passkeys.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.account_passkey_empty()}
        </p>
      ) : null}
      {account.data?.passkeys.map((key) => (
        <p key={key.id} className="text-sm">
          {key.deviceName}
        </p>
      ))}
      <p className="mt-4 text-sm">
        {account.data?.totpEnabled
          ? m.account_totp_disable()
          : m.account_totp_enable()}
      </p>
    </PageEnter>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="p-10">
      <p>{m.error_not_found()}</p>
      <Button className="mt-4" onClick={() => navigate({ to: "/console" })}>
        {m.nav_dashboard()}
      </Button>
      <Link to="/login" className="ml-3 text-sm">
        {m.action_sign_in()}
      </Link>
    </div>
  );
}
