// SPDX-License-Identifier: AGPL-3.0-only

import LoginBackdrop from "@brand/overrides/LoginBackdrop";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Input } from "@/ui/input";
import { ApiClientError, api, errorText } from "../lib/api";
import { m } from "../paraglide/messages.js";
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
      await client.invalidateQueries({ queryKey: ["meta"] });
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
    onSuccess: (data) => {
      setPushUrl(data.pushUrl ?? "");
      setStep(3);
    },
    onError: (cause) => setError(errorText(cause)),
  });

  return (
    <LoginBackdrop>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{m.setup_title()}</CardTitle>
          <p className="text-sm text-muted-foreground">{m.setup_intro()}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {step === 0 ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                setup.mutate();
              }}
            >
              <Field label={m.setup_secret()}>
                <Input
                  name="setupSecret"
                  value={form.setupSecret}
                  onChange={(event) =>
                    setForm({ ...form, setupSecret: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={m.setup_name()}>
                <Input
                  name="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label={m.setup_email()}>
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
              <Field label={m.setup_password()}>
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
                {m.setup_password_hint()}
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
              <Button type="submit">{m.action_continue()}</Button>
            </form>
          ) : null}
          {step === 1 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{m.setup_mail_title()}</h2>
              <p className="text-sm text-muted-foreground">
                {m.setup_mail_body()}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => saveMail.mutate({ driver: "none" })}
              >
                {m.setup_mail_skip()}
              </Button>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
          ) : null}
          {step === 2 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{m.setup_monitor_title()}</h2>
              <Button type="button" onClick={() => createMonitor.mutate()}>
                {m.action_create()}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(3)}
              >
                {m.action_skip()}
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{m.account_passkey_add()}</h2>
              {pushUrl ? (
                <p className="break-all font-mono text-xs">{pushUrl}</p>
              ) : null}
              <Button
                type="button"
                onClick={async () => {
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
                      deviceName: "This device",
                    }),
                  });
                  setStep(4);
                }}
              >
                {m.account_passkey_add()}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(4)}
              >
                {m.action_skip()}
              </Button>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="grid gap-3">
              <h2 className="font-medium">{m.setup_done_title()}</h2>
              <p className="text-sm text-muted-foreground">
                {m.setup_done_body()}
              </p>
              <Button type="button" onClick={() => navigate({ to: "/" })}>
                {m.nav_dashboard()}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", totp: "" });
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const login = useMutation({
    mutationFn: () =>
      api<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...form, totp: form.totp || undefined }),
      }),
    onSuccess: async (data) => {
      client.setQueryData(["session"], data);
      await navigate({ to: "/" });
    },
    onError: (cause) => {
      if (cause instanceof ApiClientError && cause.code === "totp_required")
        setNeedTotp(true);
      setError(errorText(cause));
    },
  });
  return (
    <LoginBackdrop>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{m.login_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              login.mutate();
            }}
          >
            <Field label={m.login_email()}>
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
            <Field label={m.login_password()}>
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
              <Field label={m.login_totp()}>
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit">{m.action_sign_in()}</Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
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
                await navigate({ to: "/" });
              }}
            >
              {m.login_passkey()}
            </Button>
            <Link
              to="/forgot"
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              {m.login_forgot()}
            </Link>
          </form>
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{m.reset_request()}</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p>{m.forgot_sent()}</p>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                send.mutate();
              }}
            >
              <Field label={m.login_email()}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit">{m.reset_request()}</Button>
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
  return (
    <LoginBackdrop>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{m.reset_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api("/api/auth/reset", {
                  method: "POST",
                  body: JSON.stringify({ token, password }),
                });
                await navigate({ to: "/login" });
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            <Field label={m.account_new_password()}>
              <Input
                type="password"
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit">{m.action_save()}</Button>
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
  return (
    <LoginBackdrop>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{m.invite_title()}</CardTitle>
          <p className="text-sm text-muted-foreground">{preview.data?.role}</p>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
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
                await navigate({ to: "/" });
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            <Field label={m.setup_name()}>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label={m.setup_email()}>
              <Input
                type="email"
                value={form.email || preview.data?.email || ""}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                required
              />
            </Field>
            <Field label={m.setup_password()}>
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
            <Button type="submit">{m.action_continue()}</Button>
          </form>
        </CardContent>
      </Card>
    </LoginBackdrop>
  );
}
