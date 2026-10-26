// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { formatDateTime, t } from "@shared/copy";
import { parseStoredMailError } from "@shared/mail-test";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { api, errorText, mailFailureText } from "../lib/api";
import {
  accountQuery,
  auditQuery,
  mailQuery,
  settingsQuery,
  statusPagesQuery,
  teamQuery,
  tokensQuery,
} from "../lib/queries";
import { commitServeAtRoot, refreshQueries } from "../lib/query-sync";
import { useToggleLock } from "../lib/toggle-guard";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { Stagger, StaggerItem } from "../motion/page";
import { ContentSkeleton } from "../ui/skeleton";
import { controlClass, Field } from "./fields";
import { RootSwitch, rootToggleError } from "./root-switch";

export function StatusPagesPage() {
  const pages = useQuery(statusPagesQuery);
  const client = useQueryClient();
  const toggles = useToggleLock();
  const [error, setError] = useState("");
  async function setRoot(id: string, serveAtRoot: boolean) {
    setError("");
    await toggles.run(id, async () => {
      try {
        const saved = await api<{ id: string; serveAtRoot: boolean }>(
          `/api/status-pages/${id}/root`,
          {
            method: "PUT",
            body: JSON.stringify({ serveAtRoot }),
          },
        );
        commitServeAtRoot(client, saved.id, saved.serveAtRoot);
        await refreshQueries(client, [["pages"], ["status-page"]]);
      } catch (cause) {
        setError(rootToggleError(cause));
        await refreshQueries(client, [["pages"], ["status-page"]]);
      }
    });
  }
  return (
    <>
      <AppHeader
        title={t("nav_status_pages")}
        actions={
          <Button asChild>
            <Link to="/console/status-pages/new">{t("page_new")}</Link>
          </Button>
        }
      />
      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pages.isPending ? (
        <ContentSkeleton />
      ) : (pages.data?.pages.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t("page_list_empty")}</p>
      ) : (
        <Stagger className="grid gap-3">
          {pages.data?.pages.map((page) => (
            <StaggerItem key={page.id}>
              <article className="min-w-0 rounded-lg border border-border bg-card p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={page.title}>
                      {page.title}
                    </p>
                    <p
                      className="truncate text-sm text-muted-foreground"
                      title={`/s/${page.slug}`}
                    >
                      /s/{page.slug} ·{" "}
                      <span className="tabular-nums">
                        {t("monitors_count", { count: page.itemCount })}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-3 text-sm whitespace-nowrap">
                    <Link
                      to="/console/status-pages/$id"
                      params={{ id: page.id }}
                      search={{ created: undefined }}
                    >
                      {t("action_edit")}
                    </Link>
                    <a href={`/s/${page.slug}`}>{t("page_public_link")}</a>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 border-t border-border pt-4">
                  <RootSwitch
                    checked={page.serveAtRoot}
                    pending={toggles.pendingKey === page.id}
                    disabled={
                      toggles.pending || (!page.published && !page.serveAtRoot)
                    }
                    onCheckedChange={(checked) =>
                      void setRoot(page.id, checked)
                    }
                  />
                  <p className="break-words text-sm text-muted-foreground">
                    {t("page_root_note", { slug: page.slug })}
                  </p>
                  {page.serveAtRoot ? (
                    <p className="text-sm">{t("page_root_current")}</p>
                  ) : null}
                  {page.published ? null : (
                    <p className="text-sm text-muted-foreground">
                      {t("page_root_unpublished")}
                    </p>
                  )}
                </div>
              </article>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}

export function TeamPage() {
  const team = useQuery(teamQuery);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [link, setLink] = useState("");
  const submit = useSubmitGuard();
  return (
    <>
      <AppHeader title={t("nav_team")} />
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
        <Field label={t("team_email_optional")}>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label={t("team_role")}>
          <select
            className={controlClass}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="admin">{t("role_admin")}</option>
            <option value="editor">{t("role_editor")}</option>
            <option value="viewer">{t("role_viewer")}</option>
          </select>
        </Field>
        <PendingButton type="submit" pending={submit.pending}>
          {t("team_invite")}
        </PendingButton>
      </form>
      {link ? (
        <p
          className="mb-4 max-w-full min-w-0 truncate font-mono text-xs"
          title={link}
        >
          {link}
        </p>
      ) : null}
      {team.isPending ? (
        <ContentSkeleton />
      ) : (
        <Stagger className="grid gap-2">
          {team.data?.members.map((member) => (
            <StaggerItem key={member.id}>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span
                  className="min-w-0 truncate"
                  title={`${member.name} · ${member.email}`}
                >
                  {member.name} · {member.email}
                </span>
                <span className="shrink-0 whitespace-nowrap">
                  {member.role}
                </span>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}

export function TokensPage() {
  const tokens = useQuery(tokensQuery);
  const client = useQueryClient();
  const [name, setName] = useState("CI");
  const [raw, setRaw] = useState("");
  const submit = useSubmitGuard();
  const revoke = useSubmitGuard();
  return (
    <>
      <AppHeader title={t("nav_tokens")} />
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
            await refreshQueries(client, [["tokens"]]);
          });
        }}
      >
        <Field label={t("token_name")}>
          <Input
            name="tokenName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <PendingButton type="submit" pending={submit.pending}>
          {t("token_new")}
        </PendingButton>
      </form>
      {raw ? (
        <p
          className="mb-4 max-w-full min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-muted p-3 font-mono text-xs"
          title={raw}
        >
          {t("token_once")} {raw}
        </p>
      ) : null}
      {tokens.isPending ? (
        <ContentSkeleton />
      ) : (
        <Stagger className="grid gap-2">
          {tokens.data?.tokens.map((token) => (
            <StaggerItem key={token.id}>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span
                  className="min-w-0 truncate"
                  title={`${token.name} · ${token.scopes.join(", ")}`}
                >
                  {token.name} · {token.scopes.join(", ")}
                </span>
                <PendingButton
                  size="sm"
                  variant="outline"
                  type="button"
                  pending={revoke.pending}
                  onClick={() => {
                    void revoke.run(async () => {
                      await api(`/api/tokens/${token.id}`, {
                        method: "DELETE",
                      });
                      await refreshQueries(client, [["tokens"]]);
                    });
                  }}
                >
                  {t("token_revoke")}
                </PendingButton>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}

export function AuditPage() {
  const audit = useQuery(auditQuery);
  return (
    <>
      <AppHeader title={t("nav_audit")} />
      {audit.isPending ? <ContentSkeleton /> : null}
      {!audit.isPending && (audit.data?.events.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t("audit_empty")}</p>
      ) : null}
      <Stagger className="grid gap-2">
        {audit.data?.events.map((event) => (
          <StaggerItem key={event.id}>
            <div className="grid min-w-0 gap-1 rounded-lg border border-border px-3 py-2 text-sm sm:grid-cols-3">
              <span className="truncate whitespace-nowrap tabular-nums">
                {formatDateTime(event.createdAt)}
              </span>
              <span className="truncate" title={event.action}>
                {event.action}
              </span>
              <span className="truncate text-muted-foreground">
                {event.target}
              </span>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </>
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
  lastTestOk: boolean | null;
  lastTestAt: number | null;
  lastTestError: string | null;
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

const RETENTION_CHOICES = ["7", "30", "90", "180", "365"] as const;

function retentionChoice(days: number): { choice: string; custom: string } {
  const choice = String(days);
  if ((RETENTION_CHOICES as readonly string[]).includes(choice)) {
    return { choice, custom: "" };
  }
  return { choice: "custom", custom: choice };
}

function retentionDays(choice: string, custom: string): number | null {
  if (choice !== "custom") {
    const days = Number(choice);
    return Number.isInteger(days) && days >= 1 ? days : null;
  }
  if (!/^\d+$/.test(custom.trim())) return null;
  const days = Number(custom.trim());
  if (days < 1 || days > 3650) return null;
  return days;
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

function mailPayload(form: MailDraft): Record<string, unknown> {
  if (form.driver === "none") return { driver: "none" };
  if (form.driver === "cf-email") {
    return {
      driver: "cf-email",
      fromName: form.fromName,
      fromAddress: form.fromAddress,
    };
  }
  return {
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
}

function recipientInvalid(value: string): boolean {
  const recipient = value.trim();
  return recipient.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
}

function testBlock(
  form: MailDraft,
  mail: MailSettings | undefined,
): "driver" | "fields" | "password" | "recipient" | null {
  if (recipientInvalid(form.testTo)) return "recipient";
  if (mail?.secretsOverride) return null;
  if (form.driver === "none") return "driver";
  if (form.driver === "cf-email") {
    if (!form.fromName.trim() || !form.fromAddress.trim()) return "fields";
    return null;
  }
  if (!form.host.trim() || !form.fromName.trim() || !form.fromAddress.trim())
    return "fields";
  const needsPassword =
    form.username.trim().length > 0 &&
    (form.clearPassword || !mail?.hasPassword) &&
    !form.password;
  if (needsPassword) return "password";
  return null;
}

function mailDirty(form: MailDraft, mail: MailSettings | undefined): boolean {
  if (form.password || form.clearPassword) return true;
  const saved = mailDraft(mail);
  return (
    form.driver !== saved.driver ||
    form.host !== saved.host ||
    form.port !== saved.port ||
    form.security !== saved.security ||
    form.username !== saved.username ||
    form.fromName !== saved.fromName ||
    form.fromAddress !== saved.fromAddress
  );
}

function testHelp(form: MailDraft, mail: MailSettings | undefined): string {
  switch (testBlock(form, mail)) {
    case "driver":
      return t("settings_test_need_driver");
    case "fields":
      return t("settings_test_need_fields");
    case "password":
      return t("settings_test_need_password");
    case "recipient":
      return t("settings_test_need_recipient");
    default:
      break;
  }
  if (mail?.secretsOverride) return t("settings_test_secrets");
  if (mailDirty(form, mail)) return t("settings_test_unsaved");
  return t("settings_test_saved");
}

function lastTestText(mail: MailSettings): string {
  if (mail.lastTestOk) return t("settings_last_test_ok");
  const stored = parseStoredMailError(mail.lastTestError);
  return t("settings_last_test_fail", {
    reason: mailFailureText(stored ?? {}),
  });
}

function mailSourceText(mail: MailSettings | undefined): string {
  if (!mail || mail.activeSource === "none")
    return t("settings_mail_source_none");
  if (mail.activeSource === "secrets") return t("settings_mail_source_secrets");
  if (mail.activeSource === "database")
    return t("settings_mail_source_database");
  return mail.emailBinding
    ? t("settings_mail_source_cloudflare")
    : t("settings_mail_source_cloudflare_unbound");
}

export function SettingsPage() {
  const settings = useQuery(settingsQuery);
  const mail = useQuery(mailQuery);
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [note, setNote] = useState("");
  const [noteTone, setNoteTone] = useState<"ok" | "error">("ok");
  const client = useQueryClient();
  const saveInstance = useSubmitGuard();
  const saveHistory = useSubmitGuard();
  const saveMail = useSubmitGuard();
  const testMail = useSubmitGuard();
  const [history, setHistory] = useState<{
    choice: string;
    custom: string;
  } | null>(null);
  const [historyNote, setHistoryNote] = useState("");
  const [historyTone, setHistoryTone] = useState<"ok" | "error">("ok");
  const shownName = name ?? settings.data?.instanceName ?? "";
  const shownHistory =
    history ?? retentionChoice(settings.data?.historyRetentionDays ?? 90);
  const historyValue = retentionDays(shownHistory.choice, shownHistory.custom);
  const form = draft ?? mailDraft(mail.data);
  const patch = (next: Partial<MailDraft>) => setDraft({ ...form, ...next });
  const block = testBlock(form, mail.data);
  const mailBusy = saveMail.pending || testMail.pending;

  function report(tone: "ok" | "error", text: string) {
    setNoteTone(tone);
    setNote(text);
  }

  return (
    <>
      <AppHeader title={t("nav_settings")} />
      {settings.isPending || mail.isPending ? <ContentSkeleton /> : null}
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
              await refreshQueries(client, [["settings"]]);
              report("ok", t("saved"));
            } catch (cause) {
              report("error", errorText(cause));
            }
          });
        }}
      >
        <Field
          label={t("settings_instance_name")}
          hint={t("settings_instance_hint")}
        >
          <Input
            name="instanceName"
            value={shownName}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <PendingButton type="submit" pending={saveInstance.pending}>
          {t("action_save")}
        </PendingButton>
      </form>
      <h2 className="mb-3 font-medium">{t("settings_history")}</h2>
      <p className="mb-3 max-w-xl text-sm break-words text-muted-foreground">
        {t("settings_history_intro")}
      </p>
      <form
        className="mb-8 grid max-w-xl gap-3"
        aria-label={t("settings_history")}
        onSubmit={(event) => {
          event.preventDefault();
          if (historyValue === null) {
            setHistoryTone("error");
            setHistoryNote(t("settings_history_invalid"));
            return;
          }
          void saveHistory.run(async () => {
            try {
              await api("/api/settings", {
                method: "PUT",
                body: JSON.stringify({ historyRetentionDays: historyValue }),
              });
              await refreshQueries(client, [["settings"]]);
              setHistory(null);
              setHistoryTone("ok");
              setHistoryNote(t("saved"));
            } catch (cause) {
              setHistoryTone("error");
              setHistoryNote(errorText(cause));
            }
          });
        }}
      >
        <Field
          label={t("settings_history_days")}
          hint={t("settings_history_hint")}
        >
          <select
            className={controlClass}
            name="historyRetention"
            value={shownHistory.choice}
            disabled={saveHistory.pending}
            onChange={(event) => {
              setHistoryNote("");
              setHistory({
                choice: event.target.value,
                custom: shownHistory.custom,
              });
            }}
          >
            <option value="7">{t("range_7d")}</option>
            <option value="30">{t("range_30d")}</option>
            <option value="90">{t("range_90d")}</option>
            <option value="180">{t("range_180d")}</option>
            <option value="365">{t("range_365d")}</option>
            <option value="custom">{t("settings_history_custom")}</option>
          </select>
        </Field>
        {shownHistory.choice === "custom" ? (
          <Field
            label={t("settings_history_custom_days")}
            hint={t("settings_history_custom_hint")}
          >
            <Input
              name="historyRetentionDays"
              type="number"
              min={1}
              max={3650}
              step={1}
              inputMode="numeric"
              value={shownHistory.custom}
              disabled={saveHistory.pending}
              aria-invalid={
                shownHistory.choice === "custom" && historyValue === null
              }
              onChange={(event) => {
                setHistoryNote("");
                setHistory({
                  choice: "custom",
                  custom: event.target.value,
                });
              }}
              required
            />
          </Field>
        ) : null}
        <PendingButton
          type="submit"
          pending={saveHistory.pending}
          disabled={historyValue === null}
        >
          {t("action_save")}
        </PendingButton>
        {historyNote ? (
          <p
            className={`text-sm break-words ${historyTone === "error" ? "text-destructive" : ""}`}
            role={historyTone === "error" ? "alert" : "status"}
          >
            {historyNote}
          </p>
        ) : null}
      </form>
      <h2 className="mb-3 font-medium">{t("settings_mail")}</h2>
      <p className="mb-3 max-w-xl text-sm text-muted-foreground">
        {t("settings_mail_intro")}
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
              const body = mailPayload(form);
              await api("/api/settings/mail", {
                method: "PUT",
                body: JSON.stringify(body),
              });
              setDraft({ ...form, password: "", clearPassword: false });
              await refreshQueries(client, [["mail"]]);
              report("ok", t("saved"));
            } catch (cause) {
              report("error", errorText(cause));
            }
          });
        }}
      >
        <Field label={t("settings_driver")} hint={t("settings_driver_hint")}>
          <select
            className={controlClass}
            name="driver"
            value={form.driver}
            onChange={(event) =>
              patch({ driver: event.target.value as MailDriver })
            }
          >
            <option value="smtp">{t("settings_driver_smtp")}</option>
            <option value="cf-email">{t("settings_driver_cf")}</option>
            <option value="none">{t("settings_driver_none")}</option>
          </select>
        </Field>
        {form.driver === "smtp" ? (
          <>
            <Field label={t("settings_host")} hint={t("settings_host_hint")}>
              <Input
                name="smtpHost"
                value={form.host}
                onChange={(event) => patch({ host: event.target.value })}
                required
              />
            </Field>
            <Field label={t("settings_port")} hint={t("settings_port_hint")}>
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
              label={t("settings_security")}
              hint={t("settings_security_hint")}
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
                  {t("settings_security_starttls")}
                </option>
                <option value="tls">{t("settings_security_tls")}</option>
                <option value="none">{t("settings_security_none")}</option>
              </select>
            </Field>
            <Field
              label={t("settings_username")}
              hint={t("settings_username_hint")}
            >
              <Input
                name="smtpUser"
                autoComplete="username"
                value={form.username}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </Field>
            <Field
              label={t("settings_password")}
              hint={t("settings_password_hint")}
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
              <p className="text-sm">{t("settings_password_set")}</p>
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
                {t("settings_password_clear")}
              </label>
            ) : null}
          </>
        ) : null}
        {form.driver !== "none" ? (
          <>
            <Field
              label={t("settings_from_name")}
              hint={t("settings_from_name_hint")}
            >
              <Input
                name="fromName"
                value={form.fromName}
                onChange={(event) => patch({ fromName: event.target.value })}
                required
              />
            </Field>
            <Field
              label={t("settings_from_address")}
              hint={t("settings_from_address_hint")}
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
        <Field label={t("settings_test_to")} hint={t("settings_test_hint")}>
          <Input
            name="testTo"
            type="email"
            value={form.testTo}
            onChange={(event) => patch({ testTo: event.target.value })}
            placeholder={t("settings_test_to_placeholder")}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          {testHelp(form, mail.data)}
        </p>
        {mail.data?.lastTestAt != null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {lastTestText(mail.data)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <PendingButton
            type="submit"
            pending={saveMail.pending}
            disabled={!mail.data || mailBusy}
          >
            {t("action_save")}
          </PendingButton>
          <PendingButton
            type="button"
            variant="outline"
            pending={testMail.pending}
            disabled={!mail.data || mailBusy || block !== null}
            onClick={() => {
              void testMail.run(async () => {
                try {
                  const result = await api<{
                    source: "secrets" | "saved" | "form";
                  }>("/api/settings/mail/test", {
                    method: "POST",
                    body: JSON.stringify({
                      ...mailPayload(form),
                      ...(form.testTo.trim()
                        ? { email: form.testTo.trim() }
                        : {}),
                    }),
                  });
                  await refreshQueries(client, [["mail"]]);
                  report(
                    "ok",
                    result.source === "secrets"
                      ? t("settings_test_ok_secrets")
                      : result.source === "form"
                        ? t("settings_test_ok_form")
                        : t("settings_test_ok"),
                  );
                } catch (cause) {
                  await refreshQueries(client, [["mail"]]);
                  report("error", errorText(cause));
                }
              });
            }}
          >
            {t("action_test")}
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
    </>
  );
}

export function AccountPage() {
  const account = useQuery(accountQuery);
  return (
    <>
      <AppHeader title={t("nav_account")} />
      {account.isPending ? <ContentSkeleton /> : null}
      <p
        className="mb-4 truncate text-sm text-muted-foreground"
        title={account.data?.email}
      >
        {account.data?.email}
      </p>
      <h2 className="mt-8 mb-2 font-medium">{t("account_passkeys")}</h2>
      {(account.data?.passkeys.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("account_passkey_empty")}
        </p>
      ) : null}
      {account.data?.passkeys.map((key) => (
        <p key={key.id} className="text-sm">
          {key.deviceName}
        </p>
      ))}
      <p className="mt-4 text-sm">
        {account.data?.totpEnabled
          ? t("account_totp_disable")
          : t("account_totp_enable")}
      </p>
    </>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="p-10">
      <p>{t("error_not_found")}</p>
      <Button className="mt-4" onClick={() => navigate({ to: "/console" })}>
        {t("nav_dashboard")}
      </Button>
      <Link to="/login" className="ml-3 text-sm">
        {t("action_sign_in")}
      </Link>
    </div>
  );
}
