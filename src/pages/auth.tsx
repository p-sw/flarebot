// SPDX-License-Identifier: MIT

import LoginBackdrop from "@brand/overrides/LoginBackdrop";
import { t } from "@shared/copy";
import { safeReturnPath } from "@shared/front-door";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Input } from "@/ui/input";
import { PendingButton } from "@/ui/pending-button";
import { ApiClientError, api, errorText } from "../lib/api";
import { refreshQueries } from "../lib/query-sync";
import { useSubmitGuard } from "../lib/use-submit-guard";
import type { SessionUser } from "../shell";
import { Field } from "./fields";

type Meta = {
  setupRequired: boolean;
  turnstileSiteKey: string | null;
  name: string;
};

function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/api/meta"),
  });
}

async function enterApp(
  navigate: (options: { to: "/console" }) => Promise<void>,
): Promise<void> {
  const next = safeReturnPath(
    new URLSearchParams(window.location.search).get("next"),
  );
  if (next) {
    window.location.assign(next);
    return;
  }
  await navigate({ to: "/console" });
}

export function SetupPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    setupSecret: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const submit = useSubmitGuard();

  const setup = useMutation({
    mutationFn: () =>
      api<{ user: SessionUser }>("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          turnstileToken: (window as { turnstileToken?: string })
            .turnstileToken,
        }),
      }),
    onSuccess: async (data) => {
      client.setQueryData(["session"], data);
      await refreshQueries(client, [["meta"]]);
      setStep(1);
    },
    onError: (cause) => setError(errorText(cause)),
  });

  const saveMail = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/settings/mail", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => setStep(2),
    onError: (cause) => setError(errorText(cause)),
  });

  const createMonitor = useMutation({
    mutationFn: () =>
      api<{ pushUrl?: string }>("/api/monitors", {
        method: "POST",
        body: JSON.stringify({
          name: "Example",
          type: "http",
          config: {
            url: "https://example.com",
            method: "GET",
            expectedStatuses: [200],
          },
          intervalSeconds: 60,
          timeoutSeconds: 10,
          retries: 2,
          recoveryThreshold: 1,
          channelIds: [],
        }),
      }),
    onSuccess: async (data) => {
      setPushUrl(data.pushUrl ?? "");
      await refreshQueries(client, [["monitors"]]);
      setStep(3);
    },
    onError: (cause) => setError(errorText(cause)),
  });

  return (
    <LoginBackdrop>
      <Card className="w-full min-w-0 max-w-md">
        <CardHeader>
          <CardTitle>{t("setup_title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("setup_intro")}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {step === 0 ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                void submit.run(async () => {
                  try {
                    await setup.mutateAsync();
                  } catch {
                    // onError records the message.
                  }
                });
              }}
            >
              <Field label={t("setup_secret")}>
                <Input
                  name="setupSecret"
                  value={form.setupSecret}
                  onChange={(event) =>
                    setForm({ ...form, setupSecret: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={t("setup_name")}>
                <Input
                  name="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={t("setup_email")}>
                <Input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={t("setup_password")}>
                <Input
                  name="password"
                  type="password"
                  minLength={10}
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  required
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {t("setup_password_hint")}
              </p>
              {meta.data?.turnstileSiteKey ? (
                <div
                  className="cf-turnstile"
                  data-sitekey={meta.data.turnstileSiteKey}
                  data-callback="onTurnstile"
                />
              ) : null}
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <PendingButton type="submit" pending={submit.pending}>
                {t("action_continue")}
              </PendingButton>
            </form>
          ) : null}
          {step === 1 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{t("setup_mail_title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("setup_mail_body")}
              </p>
              <PendingButton
                type="button"
                variant="outline"
                pending={submit.pending}
                onClick={() => {
                  void submit.run(async () => {
                    try {
                      await saveMail.mutateAsync({ driver: "none" });
                    } catch {
                      // onError records the message.
                    }
                  });
                }}
              >
                {t("setup_mail_skip")}
              </PendingButton>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
          ) : null}
          {step === 2 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{t("setup_monitor_title")}</h2>
              <PendingButton
                type="button"
                pending={submit.pending}
                onClick={() => {
                  void submit.run(async () => {
                    try {
                      await createMonitor.mutateAsync();
                    } catch {
                      // onError records the message.
                    }
                  });
                }}
              >
                {t("action_create")}
              </PendingButton>
              <Button
                type="button"
                variant="outline"
                disabled={submit.pending}
                onClick={() => setStep(3)}
              >
                {t("action_skip")}
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{t("account_passkey_add")}</h2>
              {pushUrl ? (
                <p
                  className="max-w-full min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs"
                  title={pushUrl}
                >
                  {pushUrl}
                </p>
              ) : null}
              <PendingButton
                type="button"
                pending={submit.pending}
                onClick={() => {
                  void submit.run(async () => {
                    const options = await api<
                      Parameters<typeof startRegistration>[0]["optionsJSON"]
                    >("/api/account/passkey/options", { method: "POST" });
                    const response = await startRegistration({
                      optionsJSON: options,
                    });
                    await api("/api/account/passkey/verify", {
                      method: "POST",
                      body: JSON.stringify({
                        response,
                        deviceName: t("passkey_this_device"),
                      }),
                    });
                    setStep(4);
                  });
                }}
              >
                {t("account_passkey_add")}
              </PendingButton>
              <Button
                type="button"
                variant="outline"
                disabled={submit.pending}
                onClick={() => setStep(4)}
              >
                {t("action_skip")}
              </Button>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{t("setup_done_title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("setup_done_body")}
              </p>
              <Button
                type="button"
                onClick={() => navigate({ to: "/console" })}
              >
                {t("nav_dashboard")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

type PublicSso = {
  hideLocalLogin: boolean;
  accessEnabled: boolean;
  providers: { id: string; displayName: string; buttonLabel: string }[];
};

function ssoErrorText(code: string | undefined): string {
  switch (code) {
    case "denied":
    case "role":
      return t("sso_error_denied");
    case "email":
      return t("sso_error_email");
    case "domain":
      return t("sso_error_domain");
    case "state":
      return t("sso_error_state");
    case "token":
      return t("sso_error_token");
    case "config":
      return t("sso_error_config");
    case "disabled":
      return t("sso_error_disabled");
    case "link":
      return t("sso_error_link");
    case "jit":
      return t("sso_error_jit");
    default:
      return "";
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const search = useSearch({ from: "/login" });
  const sso = useQuery({
    queryKey: ["sso-public"],
    queryFn: () => api<PublicSso>("/api/auth/sso"),
  });
  const [form, setForm] = useState({ email: "", password: "", totp: "" });
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const submit = useSubmitGuard();
  const breakGlass = search["break-glass"] === 1;
  const hideLocal = sso.data?.hideLocalLogin === true && !breakGlass;
  const showLocal = !hideLocal;
  const hasSso =
    (sso.data?.providers.length ?? 0) > 0 || sso.data?.accessEnabled === true;
  const login = useMutation({
    mutationFn: () =>
      api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...form, totp: form.totp || undefined }),
      }),
    onSuccess: async (data) => {
      client.setQueryData(["session"], data);
      await enterApp(navigate);
    },
    onError: (cause) => {
      if (cause instanceof ApiClientError && cause.code === "totp_required")
        setNeedTotp(true);
      setError(errorText(cause));
    },
  });
  const access = useMutation({
    mutationFn: () =>
      api<{ user: SessionUser }>("/api/auth/access", { method: "POST" }),
    onSuccess: async (data) => {
      client.setQueryData(["session"], data);
      await enterApp(navigate);
    },
    onError: (cause) => setError(errorText(cause)),
  });
  const banner = ssoErrorText(search.sso_error);
  return (
    <LoginBackdrop>
      <Card className="w-full min-w-0 max-w-md">
        <CardHeader>
          <CardTitle>{t("login_title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {banner ? (
            <p className="text-sm break-words text-destructive" role="alert">
              {banner}
            </p>
          ) : null}
          {hasSso ? (
            <div className="grid gap-2">
              {sso.data?.providers.map((provider) => (
                <Button key={provider.id} asChild className="w-full">
                  <a href={`/api/auth/oidc/${provider.id}/start`}>
                    {provider.buttonLabel}
                  </a>
                </Button>
              ))}
              {sso.data?.accessEnabled ? (
                <PendingButton
                  type="button"
                  className="w-full"
                  pending={access.isPending}
                  onClick={() => {
                    setError("");
                    access.mutate();
                  }}
                >
                  {t("login_access_button")}
                </PendingButton>
              ) : null}
              {sso.data?.accessEnabled ? (
                <p className="text-xs break-words text-muted-foreground">
                  {t("login_access_hint")}
                </p>
              ) : null}
            </div>
          ) : null}
          {hasSso && showLocal ? (
            <p className="text-center text-xs text-muted-foreground">
              {t("login_sso_divider")}
            </p>
          ) : null}
          {hideLocal ? (
            <div className="grid gap-3">
              <p className="text-sm break-words text-muted-foreground">
                {t("login_local_hidden")}
              </p>
              <Link
                to="/login"
                search={{ "break-glass": 1 }}
                className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                {t("login_break_glass")}
              </Link>
            </div>
          ) : null}
          {showLocal ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                void submit.run(async () => {
                  try {
                    await login.mutateAsync();
                  } catch {
                    // onError records the message.
                  }
                });
              }}
            >
              {breakGlass && sso.data?.hideLocalLogin ? (
                <p className="text-sm break-words text-muted-foreground">
                  {t("login_break_glass_hint")}
                </p>
              ) : null}
              <Field label={t("login_email")}>
                <Input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={t("login_password")}>
                <Input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  required
                />
              </Field>
              {needTotp ? (
                <Field label={t("login_totp")}>
                  <Input
                    name="totp"
                    inputMode="numeric"
                    value={form.totp}
                    onChange={(event) =>
                      setForm({ ...form, totp: event.target.value })
                    }
                  />
                </Field>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <PendingButton type="submit" pending={submit.pending}>
                {t("action_sign_in")}
              </PendingButton>
              <PendingButton
                type="button"
                variant="outline"
                pending={submit.pending}
                onClick={() => {
                  void submit.run(async () => {
                    try {
                      const options = await api<
                        Parameters<typeof startAuthentication>[0]["optionsJSON"]
                      >("/api/auth/passkey/options", { method: "POST" });
                      const response = await startAuthentication({
                        optionsJSON: options,
                      });
                      const session = await api<{ user: SessionUser }>(
                        "/api/auth/passkey/verify",
                        {
                          method: "POST",
                          body: JSON.stringify({ response }),
                        },
                      );
                      client.setQueryData(["session"], session);
                      await enterApp(navigate);
                    } catch (cause) {
                      setError(errorText(cause));
                    }
                  });
                }}
              >
                {t("login_passkey")}
              </PendingButton>
              <Link
                to="/forgot"
                className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              >
                {t("login_forgot")}
              </Link>
            </form>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const submit = useSubmitGuard();
  const send = useMutation({
    mutationFn: () =>
      api("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => setSent(true),
  });
  return (
    <LoginBackdrop>
      <Card className="w-full min-w-0 max-w-md">
        <CardHeader>
          <CardTitle>{t("reset_request")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p>{t("forgot_sent")}</p>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit.run(async () => {
                  try {
                    await send.mutateAsync();
                  } catch {
                    // The form stays available after a failure.
                  }
                });
              }}
            >
              <Field label={t("login_email")}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <PendingButton type="submit" pending={submit.pending}>
                {t("reset_request")}
              </PendingButton>
            </form>
          )}
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

export function ResetPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = useSubmitGuard();
  return (
    <LoginBackdrop>
      <Card className="w-full min-w-0 max-w-md">
        <CardHeader>
          <CardTitle>{t("reset_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void submit.run(async () => {
                try {
                  await api("/api/auth/reset", {
                    method: "POST",
                    body: JSON.stringify({ token, password }),
                  });
                  await navigate({ to: "/login" });
                } catch (cause) {
                  setError(errorText(cause));
                }
              });
            }}
          >
            <Field label={t("account_new_password")}>
              <Input
                type="password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <PendingButton type="submit" pending={submit.pending}>
              {t("action_save")}
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

export function InvitePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: () =>
      api<{ role: string; email: string | null }>("/api/invites/preview", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
  });
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const submit = useSubmitGuard();
  return (
    <LoginBackdrop>
      <Card className="w-full min-w-0 max-w-md">
        <CardHeader>
          <CardTitle>{t("invite_title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{preview.data?.role}</p>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void submit.run(async () => {
                try {
                  const session = await api<{ user: SessionUser }>(
                    "/api/invites/accept",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        token,
                        ...form,
                        email: form.email || preview.data?.email,
                      }),
                    },
                  );
                  client.setQueryData(["session"], session);
                  await enterApp(navigate);
                } catch (cause) {
                  setError(errorText(cause));
                }
              });
            }}
          >
            <Field label={t("setup_name")}>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label={t("setup_email")}>
              <Input
                type="email"
                value={form.email || preview.data?.email || ""}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                required
              />
            </Field>
            <Field label={t("setup_password")}>
              <Input
                type="password"
                minLength={10}
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
                required
              />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <PendingButton type="submit" pending={submit.pending}>
              {t("action_continue")}
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}
