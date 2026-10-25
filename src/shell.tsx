// SPDX-License-Identifier: MIT

import logo from "@brand/assets/logo.svg";
import brand from "@brand/brand.config";
import AppFooter from "@brand/overrides/AppFooter";
import { isSupportedLocale } from "@shared/locales";
import { can, type Role } from "@shared/permissions";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/ui/button";
import { PendingButton } from "@/ui/pending-button";
import { api, errorText } from "./lib/api";
import { useSubmitGuard } from "./lib/use-submit-guard";
import { m } from "./paraglide/messages.js";
import { getLocale, setLocale } from "./paraglide/runtime.js";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  role: Role;
  organizationId: string;
};

const links = [
  {
    to: "/console",
    label: () => m.nav_dashboard(),
    action: "dashboard.read" as const,
  },
  {
    to: "/console/monitors/new",
    label: () => m.monitor_new(),
    action: "monitors.write" as const,
  },
  {
    to: "/console/status-pages",
    label: () => m.nav_status_pages(),
    action: "status_pages.read" as const,
  },
  {
    to: "/console/channels",
    label: () => m.nav_channels(),
    action: "channels.read" as const,
  },
  {
    to: "/console/team",
    label: () => m.nav_team(),
    action: "users.read" as const,
  },
  {
    to: "/console/tokens",
    label: () => m.nav_tokens(),
    action: "tokens.read" as const,
  },
  {
    to: "/console/audit",
    label: () => m.nav_audit(),
    action: "audit.read" as const,
  },
  {
    to: "/console/settings",
    label: () => m.nav_settings(),
    action: "instance.settings" as const,
  },
  {
    to: "/console/account",
    label: () => m.nav_account(),
    action: "dashboard.read" as const,
  },
];

export function Shell({ user }: { user: SessionUser }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const client = useQueryClient();
  const navigate = useNavigate();
  const language = useSubmitGuard();
  const signOut = useSubmitGuard();
  const [languageError, setLanguageError] = useState("");
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 bg-sidebar px-4 py-6 text-sidebar-foreground">
        <Link to="/console" className="flex items-center gap-2 px-2">
          <img src={logo} alt="" className="h-8 w-8" />
          <span className="font-medium">{brand.name}</span>
        </Link>
        <nav className="grid gap-1">
          {links
            .filter((link) => can({ role: user.role }, link.action))
            .map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-lg px-3 py-2 text-sm ${path === link.to ? "bg-white/10" : "text-sidebar-muted hover:bg-white/5"}`}
              >
                {link.label()}
              </Link>
            ))}
        </nav>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <label className="text-xs text-muted-foreground">
            {m.language()}
            <select
              className="ml-2 h-8 max-w-full rounded-lg border border-border bg-card px-2"
              value={getLocale()}
              disabled={language.pending}
              aria-busy={language.pending || undefined}
              onChange={(event) => {
                const next = event.target.value;
                if (!isSupportedLocale(next) || next === getLocale()) return;
                setLanguageError("");
                void language.run(async () => {
                  try {
                    await api("/api/account", {
                      method: "PATCH",
                      body: JSON.stringify({ locale: next }),
                    });
                    await setLocale(next);
                    window.location.reload();
                  } catch (cause) {
                    setLanguageError(errorText(cause));
                  }
                });
              }}
            >
              <option value="en">{m.language_en()}</option>
              <option value="ko">{m.language_ko()}</option>
            </select>
          </label>
          {languageError ? (
            <p className="text-xs text-destructive" role="alert">
              {languageError}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const next = document.documentElement.classList.contains("dark")
                ? "light"
                : "dark";
              document.documentElement.classList.toggle(
                "dark",
                next === "dark",
              );
              localStorage.setItem("theme", next);
            }}
          >
            {m.theme_dark()}
          </Button>
          <PendingButton
            size="sm"
            variant="ghost"
            type="button"
            pending={signOut.pending}
            onClick={() => {
              void signOut.run(async () => {
                await api("/api/auth/logout", { method: "POST" });
                client.clear();
                await navigate({ to: "/login" });
              });
            }}
          >
            {m.action_sign_out()}
          </PendingButton>
        </div>
        <main className="flex-1">
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
