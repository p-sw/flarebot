// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { ROLES, type Role } from "@shared/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { api, errorText } from "../lib/api";
import {
  type SsoAccessView,
  type SsoProviderView,
  type SsoRole,
  type SsoSettingsResponse,
  ssoQuery,
} from "../lib/queries";
import { refreshQueries } from "../lib/query-sync";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { controlClass, Field } from "./fields";

type RuleKind = SsoAccessView["rules"][number]["kind"];

type KeyedRule = SsoAccessView["rules"][number] & { key: string };
type KeyedMapping = { key: string; value: string; role: SsoRole };

function withKey<T extends object>(item: T): T & { key: string } {
  return { ...item, key: crypto.randomUUID() };
}

type PolicyDraft = {
  hideLocalLogin: boolean;
  enabled: boolean;
  teamName: string;
  audiences: string;
  groupsClaim: string;
  jitEnabled: boolean;
  domains: string;
  rules: KeyedRule[];
};

type ProviderDraft = {
  id: string | null;
  enabled: boolean;
  displayName: string;
  buttonLabel: string;
  buttonTouched: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  clearClientSecret: boolean;
  secretWasSet: boolean;
  scopes: string;
  groupsClaim: string;
  jitEnabled: boolean;
  jitRole: SsoRole;
  domains: string;
  mappings: KeyedMapping[];
};

type DiscoveryResult = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function roleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return t("role_owner");
    case "admin":
      return t("role_admin");
    case "editor":
      return t("role_editor");
    case "viewer":
      return t("role_viewer");
  }
}

function policyFrom(data: SsoSettingsResponse): PolicyDraft {
  return {
    hideLocalLogin: data.hideLocalLogin,
    enabled: data.access.enabled,
    teamName: data.access.teamName,
    audiences: data.access.audiences.join("\n"),
    groupsClaim: data.access.groupsClaim,
    jitEnabled: data.access.jitEnabled,
    domains: data.access.allowedDomains.join("\n"),
    rules: data.access.rules.map((rule) => withKey(rule)),
  };
}

function emptyProvider(): ProviderDraft {
  return {
    id: null,
    enabled: true,
    displayName: "",
    buttonLabel: "",
    buttonTouched: false,
    issuerUrl: "",
    clientId: "",
    clientSecret: "",
    clearClientSecret: false,
    secretWasSet: false,
    scopes: "openid email profile",
    groupsClaim: "groups",
    jitEnabled: false,
    jitRole: "viewer",
    domains: "",
    mappings: [],
  };
}

function providerFrom(row: SsoProviderView): ProviderDraft {
  return {
    id: row.id,
    enabled: row.enabled,
    displayName: row.displayName,
    buttonLabel: row.buttonLabel,
    buttonTouched: true,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecret: "",
    clearClientSecret: false,
    secretWasSet: row.clientSecretSet,
    scopes: row.scopes,
    groupsClaim: row.groupsClaim,
    jitEnabled: row.jitEnabled,
    jitRole: row.jitRole,
    domains: row.allowedDomains.join("\n"),
    mappings: row.roleMappings.map((mapping) => withKey(mapping)),
  };
}

function RoleSelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: SsoRole;
  label: string;
  disabled?: boolean;
  onChange: (role: SsoRole) => void;
}) {
  return (
    <select
      className={controlClass}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SsoRole)}
    >
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function ToggleRow({
  checked,
  label,
  hint,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs break-words text-muted-foreground">{hint}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function Note({ tone, text }: { tone: "ok" | "error"; text: string }) {
  if (!text) return null;
  return (
    <p
      className={`text-sm break-words ${tone === "error" ? "text-destructive" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {text}
    </p>
  );
}

export function SsoSettings() {
  const data = useQuery(ssoQuery);
  const client = useQueryClient();
  const savePolicy = useSubmitGuard();
  const saveProvider = useSubmitGuard();
  const testDiscovery = useSubmitGuard();
  const removeProvider = useSubmitGuard();
  const [policy, setPolicy] = useState<PolicyDraft | null>(null);
  const [policyNote, setPolicyNote] = useState("");
  const [policyTone, setPolicyTone] = useState<"ok" | "error">("ok");
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [providerNote, setProviderNote] = useState("");
  const [providerTone, setProviderTone] = useState<"ok" | "error">("ok");
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (data.isPending) return <p className="text-sm">{t("loading")}</p>;
  if (!data.data) return <p className="text-sm">{t("error_forbidden")}</p>;
  const settings = data.data;
  const form = policy ?? policyFrom(settings);
  const localHidden =
    form.hideLocalLogin &&
    !form.enabled &&
    !settings.providers.some((item) => item.enabled);
  const patchPolicy = (next: Partial<PolicyDraft>) =>
    setPolicy({ ...form, ...next });

  async function persistPolicy(event: FormEvent) {
    event.preventDefault();
    setPolicyNote("");
    await savePolicy.run(async () => {
      try {
        await api("/api/sso/policy", {
          method: "PUT",
          body: JSON.stringify({
            hideLocalLogin: form.hideLocalLogin,
            access: {
              enabled: form.enabled,
              teamName: form.teamName,
              audiences: lines(form.audiences),
              groupsClaim: form.groupsClaim,
              jitEnabled: form.jitEnabled,
              allowedDomains: lines(form.domains),
              rules: form.rules
                .filter((rule) => rule.value.trim())
                .map(({ key: _key, ...rule }) => rule),
            },
          }),
        });
        setPolicy(null);
        await refreshQueries(client, [["sso"]]);
        setPolicyTone("ok");
        setPolicyNote(t("saved"));
      } catch (cause) {
        setPolicyTone("error");
        setPolicyNote(errorText(cause));
      }
    });
  }

  return (
    <section className="mt-10 grid min-w-0 max-w-xl gap-8">
      <div className="grid gap-3">
        <h2 className="font-medium">{t("sso_title")}</h2>
        <p className="text-sm break-words text-muted-foreground">
          {t("sso_intro")}
        </p>
      </div>

      <form
        className="grid gap-4"
        onSubmit={(event) => void persistPolicy(event)}
      >
        <ToggleRow
          checked={form.hideLocalLogin}
          label={t("sso_hide_local")}
          hint={t("sso_hide_local_hint")}
          disabled={savePolicy.pending}
          onCheckedChange={(checked) =>
            patchPolicy({ hideLocalLogin: checked })
          }
        />
        {localHidden ? (
          <p className="text-sm text-destructive" role="status">
            {t("sso_hide_local_warning")}
          </p>
        ) : null}
        <Field
          label={t("sso_break_glass_path")}
          hint={t("sso_break_glass_hint")}
        >
          <div className="flex min-w-0 gap-2">
            <Input
              readOnly
              value={`${window.location.origin}/login?break-glass=1`}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `${window.location.origin}/login?break-glass=1`,
                );
                setPolicyTone("ok");
                setPolicyNote(t("copied"));
              }}
            >
              {t("action_copy")}
            </Button>
          </div>
        </Field>

        <div className="grid gap-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{t("sso_access_title")}</h3>
          <p className="text-sm break-words text-muted-foreground">
            {t("sso_access_intro")}
          </p>
          <ToggleRow
            checked={form.enabled}
            label={t("sso_access_enabled")}
            hint={t("sso_access_enabled_hint")}
            disabled={savePolicy.pending}
            onCheckedChange={(checked) => patchPolicy({ enabled: checked })}
          />
          <Field label={t("sso_access_team")} hint={t("sso_access_team_hint")}>
            <Input
              name="accessTeam"
              value={form.teamName}
              disabled={savePolicy.pending}
              onChange={(event) =>
                patchPolicy({ teamName: event.target.value })
              }
            />
          </Field>
          <Field label={t("sso_access_aud")} hint={t("sso_access_aud_hint")}>
            <Textarea
              name="accessAud"
              value={form.audiences}
              disabled={savePolicy.pending}
              onChange={(event) =>
                patchPolicy({ audiences: event.target.value })
              }
            />
          </Field>
          <Field
            label={t("sso_access_groups_claim")}
            hint={t("sso_access_groups_claim_hint")}
          >
            <Input
              name="accessGroupsClaim"
              value={form.groupsClaim}
              disabled={savePolicy.pending}
              onChange={(event) =>
                patchPolicy({ groupsClaim: event.target.value })
              }
            />
          </Field>
          <ToggleRow
            checked={form.jitEnabled}
            label={t("sso_access_jit")}
            hint={t("sso_access_jit_hint")}
            disabled={savePolicy.pending}
            onCheckedChange={(checked) => patchPolicy({ jitEnabled: checked })}
          />
          <Field
            label={t("sso_access_domains")}
            hint={t("sso_access_domains_hint")}
          >
            <Textarea
              name="accessDomains"
              value={form.domains}
              disabled={savePolicy.pending}
              onChange={(event) => patchPolicy({ domains: event.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t("sso_access_rules")}</p>
            <p className="text-xs break-words text-muted-foreground">
              {t("sso_access_rules_hint")}
            </p>
            {form.rules.map((rule, index) => (
              <div
                key={rule.key}
                className="grid min-w-0 gap-2 sm:grid-cols-[8rem_1fr_8rem_auto]"
              >
                <select
                  className={controlClass}
                  aria-label={t("sso_rule_kind")}
                  value={rule.kind}
                  disabled={savePolicy.pending}
                  onChange={(event) => {
                    const rules = form.rules.slice();
                    const kind = event.target.value as RuleKind;
                    const current = rules[index];
                    if (!current) return;
                    rules[index] = { ...current, kind };
                    patchPolicy({ rules });
                  }}
                >
                  <option value="group">{t("sso_rule_group")}</option>
                  <option value="email">{t("sso_rule_email")}</option>
                  <option value="domain">{t("sso_rule_domain")}</option>
                </select>
                <Input
                  aria-label={t("sso_rule_value")}
                  value={rule.value}
                  disabled={savePolicy.pending}
                  onChange={(event) => {
                    const rules = form.rules.slice();
                    const current = rules[index];
                    if (!current) return;
                    rules[index] = { ...current, value: event.target.value };
                    patchPolicy({ rules });
                  }}
                />
                <RoleSelect
                  value={rule.role}
                  label={t("sso_mapping_role")}
                  disabled={savePolicy.pending}
                  onChange={(role) => {
                    const rules = form.rules.slice();
                    const current = rules[index];
                    if (!current) return;
                    rules[index] = { ...current, role };
                    patchPolicy({ rules });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={savePolicy.pending}
                  onClick={() =>
                    patchPolicy({
                      rules: form.rules.filter((_, item) => item !== index),
                    })
                  }
                >
                  {t("sso_mapping_remove")}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={savePolicy.pending}
              onClick={() =>
                patchPolicy({
                  rules: [
                    ...form.rules,
                    withKey({ kind: "group", value: "", role: "viewer" }),
                  ],
                })
              }
            >
              {t("sso_mapping_add")}
            </Button>
          </div>
        </div>
        <PendingButton type="submit" pending={savePolicy.pending}>
          {t("sso_policy_save")}
        </PendingButton>
        <Note tone={policyTone} text={policyNote} />
      </form>

      <div className="grid gap-3">
        <h3 className="font-medium">{t("sso_providers")}</h3>
        <p className="text-sm break-words text-muted-foreground">
          {t("sso_providers_hint")}
        </p>
        <Field label={t("sso_redirect_label")} hint={t("sso_redirect_hint")}>
          <div className="flex min-w-0 gap-2">
            <Input
              className="min-w-0 flex-1"
              readOnly
              value={settings.redirectUri}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(settings.redirectUri);
                setProviderTone("ok");
                setProviderNote(t("copied"));
              }}
            >
              {t("action_copy")}
            </Button>
          </div>
        </Field>
        {settings.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("sso_provider_none")}
          </p>
        ) : (
          <ul className="grid gap-2">
            {settings.providers.map((provider) => (
              <li
                key={provider.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {provider.displayName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {provider.enabled
                      ? t("sso_provider_on")
                      : t("sso_provider_off")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(providerFrom(provider));
                    setDiscovery(null);
                    setProviderNote("");
                  }}
                >
                  {t("action_edit")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(emptyProvider());
            setDiscovery(null);
            setProviderNote("");
          }}
        >
          {t("sso_provider_add")}
        </Button>
        {draft ? (
          <ProviderForm
            draft={draft}
            saving={saveProvider.pending}
            testing={testDiscovery.pending}
            discovery={discovery}
            onChange={setDraft}
            onTest={() => {
              setProviderNote("");
              void testDiscovery.run(async () => {
                try {
                  const result = await api<DiscoveryResult>(
                    "/api/sso/discovery",
                    {
                      method: "POST",
                      body: JSON.stringify({ issuerUrl: draft.issuerUrl }),
                    },
                  );
                  setDiscovery(result);
                  setProviderTone("ok");
                  setProviderNote(
                    t("sso_discovery_ok", { issuer: result.issuer }),
                  );
                } catch (cause) {
                  setDiscovery(null);
                  setProviderTone("error");
                  setProviderNote(errorText(cause));
                }
              });
            }}
            onSubmit={() => {
              setProviderNote("");
              void saveProvider.run(async () => {
                try {
                  const body = {
                    enabled: draft.enabled,
                    displayName: draft.displayName,
                    buttonLabel:
                      draft.buttonLabel ||
                      t("login_sso_button", { name: draft.displayName }),
                    issuerUrl: draft.issuerUrl,
                    clientId: draft.clientId,
                    clientSecret: draft.clientSecret,
                    clearClientSecret: draft.clearClientSecret,
                    scopes: draft.scopes,
                    groupsClaim: draft.groupsClaim,
                    jitEnabled: draft.jitEnabled,
                    jitRole: draft.jitRole,
                    allowedDomains: lines(draft.domains),
                    roleMappings: draft.mappings
                      .filter((item) => item.value.trim())
                      .map(({ key: _key, ...item }) => item),
                  };
                  await api(
                    draft.id
                      ? `/api/sso/providers/${draft.id}`
                      : "/api/sso/providers",
                    {
                      method: draft.id ? "PUT" : "POST",
                      body: JSON.stringify(body),
                    },
                  );
                  setDraft(null);
                  setDiscovery(null);
                  await refreshQueries(client, [["sso"]]);
                  setProviderTone("ok");
                  setProviderNote(t("saved"));
                } catch (cause) {
                  setProviderTone("error");
                  setProviderNote(errorText(cause));
                }
              });
            }}
            onDelete={() => {
              if (draft.id) setDeleteId(draft.id);
            }}
            onCancel={() => setDraft(null)}
          />
        ) : null}
        <Note tone={providerTone} text={providerNote} />
      </div>
      <ConfirmDialog
        open={deleteId !== null}
        pending={removeProvider.pending}
        title={t("sso_provider_delete_title")}
        description={t("sso_provider_delete_hint")}
        confirmLabel={
          removeProvider.pending ? t("action_working") : t("action_delete")
        }
        cancelLabel={t("action_cancel")}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={() => {
          if (!deleteId) return;
          void removeProvider.run(async () => {
            try {
              await api(`/api/sso/providers/${deleteId}`, { method: "DELETE" });
              setDeleteId(null);
              setDraft(null);
              await refreshQueries(client, [["sso"]]);
              setProviderTone("ok");
              setProviderNote(t("saved"));
            } catch (cause) {
              setProviderTone("error");
              setProviderNote(errorText(cause));
            }
          });
        }}
      />
    </section>
  );
}

function ProviderForm({
  draft,
  saving,
  testing,
  discovery,
  onChange,
  onTest,
  onSubmit,
  onDelete,
  onCancel,
}: {
  draft: ProviderDraft;
  saving: boolean;
  testing: boolean;
  discovery: DiscoveryResult | null;
  onChange: (next: ProviderDraft) => void;
  onTest: () => void;
  onSubmit: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const pending = saving || testing;
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ToggleRow
        checked={draft.enabled}
        label={t("sso_provider_enabled")}
        hint={t("sso_provider_enabled_hint")}
        disabled={pending}
        onCheckedChange={(checked) => onChange({ ...draft, enabled: checked })}
      />
      <Field label={t("sso_display_name")} hint={t("sso_display_name_hint")}>
        <Input
          name="displayName"
          value={draft.displayName}
          disabled={pending}
          required
          onChange={(event) => {
            const displayName = event.target.value;
            onChange({
              ...draft,
              displayName,
              buttonLabel: draft.buttonTouched
                ? draft.buttonLabel
                : displayName
                  ? t("login_sso_button", { name: displayName })
                  : "",
            });
          }}
        />
      </Field>
      <Field label={t("sso_button_label")} hint={t("sso_button_label_hint")}>
        <Input
          name="buttonLabel"
          value={draft.buttonLabel}
          disabled={pending}
          required
          onChange={(event) =>
            onChange({
              ...draft,
              buttonLabel: event.target.value,
              buttonTouched: true,
            })
          }
        />
      </Field>
      <Field label={t("sso_issuer")} hint={t("sso_issuer_hint")}>
        <Input
          name="issuerUrl"
          value={draft.issuerUrl}
          disabled={pending}
          required
          onChange={(event) =>
            onChange({ ...draft, issuerUrl: event.target.value })
          }
        />
      </Field>
      <div className="grid gap-1">
        <PendingButton
          type="button"
          variant="outline"
          pending={testing}
          disabled={pending}
          onClick={onTest}
        >
          {t("sso_test_discovery")}
        </PendingButton>
        <p className="text-xs text-muted-foreground">
          {t("sso_test_discovery_hint")}
        </p>
      </div>
      {discovery ? (
        <dl className="grid gap-1 text-xs break-all text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">
              {t("sso_discovery_auth")}
            </dt>
            <dd>{discovery.authorizationEndpoint}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              {t("sso_discovery_token")}
            </dt>
            <dd>{discovery.tokenEndpoint}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              {t("sso_discovery_jwks")}
            </dt>
            <dd>{discovery.jwksUri}</dd>
          </div>
        </dl>
      ) : null}
      <Field label={t("sso_client_id")} hint={t("sso_client_id_hint")}>
        <Input
          name="clientId"
          value={draft.clientId}
          disabled={pending}
          required
          onChange={(event) =>
            onChange({ ...draft, clientId: event.target.value })
          }
        />
      </Field>
      <Field label={t("sso_client_secret")} hint={t("sso_client_secret_hint")}>
        <Input
          name="clientSecret"
          type="password"
          value={draft.clientSecret}
          disabled={pending}
          autoComplete="new-password"
          onChange={(event) =>
            onChange({
              ...draft,
              clientSecret: event.target.value,
              clearClientSecret: false,
            })
          }
        />
      </Field>
      {draft.secretWasSet ? (
        <p className="text-xs text-muted-foreground">
          {t("sso_client_secret_set")}
        </p>
      ) : null}
      {draft.secretWasSet ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.clearClientSecret}
            disabled={pending}
            onChange={(event) =>
              onChange({ ...draft, clearClientSecret: event.target.checked })
            }
          />
          <span>{t("sso_clear_secret")}</span>
        </label>
      ) : null}
      <Field label={t("sso_scopes")} hint={t("sso_scopes_hint")}>
        <Input
          name="scopes"
          value={draft.scopes}
          disabled={pending}
          required
          onChange={(event) =>
            onChange({ ...draft, scopes: event.target.value })
          }
        />
      </Field>
      <Field label={t("sso_groups_claim")} hint={t("sso_groups_claim_hint")}>
        <Input
          name="groupsClaim"
          value={draft.groupsClaim}
          disabled={pending}
          required
          onChange={(event) =>
            onChange({ ...draft, groupsClaim: event.target.value })
          }
        />
      </Field>
      <ToggleRow
        checked={draft.jitEnabled}
        label={t("sso_jit")}
        hint={t("sso_jit_hint")}
        disabled={pending}
        onCheckedChange={(checked) =>
          onChange({ ...draft, jitEnabled: checked })
        }
      />
      <Field label={t("sso_jit_role")} hint={t("sso_jit_role_hint")}>
        <RoleSelect
          value={draft.jitRole}
          label={t("sso_jit_role")}
          disabled={pending}
          onChange={(jitRole) => onChange({ ...draft, jitRole })}
        />
      </Field>
      <Field label={t("sso_domains")} hint={t("sso_domains_hint")}>
        <Textarea
          name="allowedDomains"
          value={draft.domains}
          disabled={pending}
          onChange={(event) =>
            onChange({ ...draft, domains: event.target.value })
          }
        />
      </Field>
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t("sso_mappings")}</p>
        <p className="text-xs break-words text-muted-foreground">
          {t("sso_mappings_hint")}
        </p>
        {draft.mappings.map((mapping, index) => (
          <div
            key={mapping.key}
            className="grid min-w-0 gap-2 sm:grid-cols-[1fr_8rem_auto]"
          >
            <Input
              aria-label={t("sso_mapping_value")}
              value={mapping.value}
              disabled={pending}
              onChange={(event) => {
                const mappings = draft.mappings.slice();
                const current = mappings[index];
                if (!current) return;
                mappings[index] = { ...current, value: event.target.value };
                onChange({ ...draft, mappings });
              }}
            />
            <RoleSelect
              value={mapping.role}
              label={t("sso_mapping_role")}
              disabled={pending}
              onChange={(role) => {
                const mappings = draft.mappings.slice();
                const current = mappings[index];
                if (!current) return;
                mappings[index] = { ...current, role };
                onChange({ ...draft, mappings });
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                onChange({
                  ...draft,
                  mappings: draft.mappings.filter((_, item) => item !== index),
                })
              }
            >
              {t("sso_mapping_remove")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            onChange({
              ...draft,
              mappings: [
                ...draft.mappings,
                withKey({ value: "", role: "viewer" }),
              ],
            })
          }
        >
          {t("sso_mapping_add")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <PendingButton type="submit" pending={saving} disabled={pending}>
          {t("sso_provider_save")}
        </PendingButton>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {t("action_cancel")}
        </Button>
        {draft.id ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onDelete}
          >
            {t("sso_provider_delete")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
