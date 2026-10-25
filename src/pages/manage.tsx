// SPDX-License-Identifier: AGPL-3.0-only

import AppHeader from "@brand/overrides/AppHeader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { Input } from "@/ui/input";
import { api, errorText } from "../lib/api";
import { PageEnter } from "../motion/page";
import { m } from "../paraglide/messages.js";
import { setLocale } from "../paraglide/runtime.js";
import { Field } from "./fields";

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
  return (
    <PageEnter>
      <AppHeader title={m.nav_status_pages()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
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
            className="h-10 rounded-lg border border-input bg-card px-3"
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
        <Button type="submit">{m.page_new()}</Button>
      </form>
      <div className="grid gap-3">
        {pages.data?.pages.map((page) => (
          <Card key={page.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{page.title}</p>
                <p className="text-sm text-muted-foreground">
                  /s/{page.slug} · {m.missing_count({ count: page.missing })}
                </p>
              </div>
              <a href={`/s/${page.slug}`}>{m.page_public_link()}</a>
            </CardContent>
          </Card>
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
  return (
    <PageEnter>
      <AppHeader title={m.nav_channels()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await api("/api/channels", {
            method: "POST",
            body: JSON.stringify({ name, type: "email", config: { to } }),
          });
          await client.invalidateQueries({ queryKey: ["channels"] });
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
        <Button type="submit">{m.channel_new()}</Button>
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
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api(`/api/channels/${channel.id}/test`, {
                    method: "POST",
                  });
                  setMessage(m.channel_test_sent());
                } catch (cause) {
                  setMessage(errorText(cause));
                }
              }}
            >
              {m.action_test()}
            </Button>
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
  return (
    <PageEnter>
      <AppHeader title={m.nav_team()} />
      <form
        className="mb-6 grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await api<{ link: string }>("/api/team/invites", {
            method: "POST",
            body: JSON.stringify({ email: email || undefined, role }),
          });
          setLink(created.link);
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
            className="h-10 rounded-lg border border-input bg-card px-3"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="admin">{m.role_admin()}</option>
            <option value="editor">{m.role_editor()}</option>
            <option value="viewer">{m.role_viewer()}</option>
          </select>
        </Field>
        <Button type="submit">{m.team_invite()}</Button>
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
  return (
    <PageEnter>
      <AppHeader title={m.nav_tokens()} />
      <form
        className="mb-4 grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await api<{ token: string }>("/api/tokens", {
            method: "POST",
            body: JSON.stringify({ name, scopes: ["read"] }),
          });
          setRaw(created.token);
          await client.invalidateQueries({ queryKey: ["tokens"] });
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
        <Button type="submit">{m.token_new()}</Button>
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
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await api(`/api/tokens/${token.id}`, { method: "DELETE" });
                await client.invalidateQueries({ queryKey: ["tokens"] });
              }}
            >
              {m.token_revoke()}
            </Button>
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
            className="grid grid-cols-3 gap-2 rounded-lg border border-border px-3 py-2 text-sm"
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
    queryFn: () =>
      api<{
        driver: string;
        host: string;
        port: number;
        fromName: string;
        fromAddress: string;
        secretsOverride: boolean;
      }>("/api/settings/mail"),
  });
  const [name, setName] = useState("");
  const [host, setHost] = useState("smtp.example.com");
  const [from, setFrom] = useState("bot@example.com");
  const [note, setNote] = useState("");
  const client = useQueryClient();
  return (
    <PageEnter>
      <AppHeader title={m.nav_settings()} />
      <form
        className="mb-8 grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await api("/api/settings", {
            method: "PUT",
            body: JSON.stringify({
              instanceName: name || settings.data?.instanceName,
            }),
          });
          await client.invalidateQueries({ queryKey: ["settings"] });
          setNote(m.saved());
        }}
      >
        <Field label={m.settings_instance_name()}>
          <Input
            name="instanceName"
            value={name || settings.data?.instanceName || ""}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          {m.settings_access_unavailable()}
        </p>
        <Button type="submit">{m.action_save()}</Button>
      </form>
      <h2 className="mb-3 font-medium">{m.settings_mail()}</h2>
      {mail.data?.secretsOverride ? (
        <p className="mb-3 text-sm">{m.settings_secrets_override()}</p>
      ) : null}
      <form
        className="grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await api("/api/settings/mail", {
            method: "PUT",
            body: JSON.stringify({
              driver: "smtp",
              host,
              port: 587,
              security: "starttls",
              username: "",
              password: "secret",
              fromName: "Flarebot",
              fromAddress: from,
            }),
          });
          setNote(m.saved());
        }}
      >
        <Field label={m.settings_host()}>
          <Input
            name="smtpHost"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </Field>
        <Field label={m.settings_from_address()}>
          <Input
            name="from"
            type="email"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">{m.action_save()}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await api("/api/settings/mail/test", {
                  method: "POST",
                  body: JSON.stringify({}),
                });
                setNote(m.settings_test_ok());
              } catch (cause) {
                setNote(errorText(cause));
              }
            }}
          >
            {m.action_test()}
          </Button>
        </div>
      </form>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
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
  const [locale, setValue] = useState(account.data?.locale ?? "en");
  return (
    <PageEnter>
      <AppHeader title={m.nav_account()} />
      <p className="mb-4 text-sm text-muted-foreground">
        {account.data?.email}
      </p>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await api("/api/account", {
            method: "PATCH",
            body: JSON.stringify({ locale }),
          });
          await setLocale(locale as "en" | "ko");
          window.location.reload();
        }}
      >
        <Field label={m.account_language()}>
          <select
            className="h-10 rounded-lg border border-input bg-card px-3"
            value={locale}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="en">{m.language_en()}</option>
            <option value="ko">{m.language_ko()}</option>
          </select>
        </Field>
        <Button type="submit">{m.action_save()}</Button>
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
      <Button className="mt-4" onClick={() => navigate({ to: "/" })}>
        {m.nav_dashboard()}
      </Button>
      <Link to="/login" className="ml-3 text-sm">
        {m.action_sign_in()}
      </Link>
    </div>
  );
}
