// SPDX-License-Identifier: MIT

import logo from "@brand/assets/logo.svg";
import AppFooter from "@brand/overrides/AppFooter";
import { t } from "@shared/copy";
import { can, type Role } from "@shared/permissions";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  Bell,
  CircleUser,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Plus,
  ScrollText,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { api } from "./lib/api";
import { cn } from "./lib/cn";
import { dropCachedSession } from "./lib/session-cache";
import { useSubmitGuard } from "./lib/use-submit-guard";
import { useMotionPrefs } from "./motion/page";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
};

const links: {
  to:
    | "/console"
    | "/console/monitors/new"
    | "/console/status-pages"
    | "/console/channels"
    | "/console/team"
    | "/console/tokens"
    | "/console/audit"
    | "/console/settings";
  label: () => string;
  action:
    | "dashboard.read"
    | "monitors.write"
    | "status_pages.read"
    | "channels.read"
    | "users.read"
    | "tokens.read"
    | "audit.read"
    | "instance.settings";
  icon: LucideIcon;
}[] = [
  {
    to: "/console",
    label: () => t("nav_dashboard"),
    action: "dashboard.read",
    icon: LayoutDashboard,
  },
  {
    to: "/console/monitors/new",
    label: () => t("monitor_new"),
    action: "monitors.write",
    icon: Plus,
  },
  {
    to: "/console/status-pages",
    label: () => t("nav_status_pages"),
    action: "status_pages.read",
    icon: Globe,
  },
  {
    to: "/console/channels",
    label: () => t("nav_channels"),
    action: "channels.read",
    icon: Bell,
  },
  {
    to: "/console/team",
    label: () => t("nav_team"),
    action: "users.read",
    icon: Users,
  },
  {
    to: "/console/tokens",
    label: () => t("nav_tokens"),
    action: "tokens.read",
    icon: KeyRound,
  },
  {
    to: "/console/audit",
    label: () => t("nav_audit"),
    action: "audit.read",
    icon: ScrollText,
  },
  {
    to: "/console/settings",
    label: () => t("nav_settings"),
    action: "instance.settings",
    icon: Settings,
  },
];

function NavigationProgress() {
  const pending = useRouterState({
    select: (state) => state.status === "pending",
  });
  const motionPrefs = useMotionPrefs();
  if (!pending) return null;
  return (
    <div
      role="progressbar"
      aria-label={t("loading")}
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-1 overflow-hidden bg-primary/20"
    >
      <motion.div
        className="h-full origin-left bg-primary"
        initial={{ scaleX: motionPrefs.still ? 0.85 : 0.08 }}
        animate={{ scaleX: 0.85 }}
        transition={
          motionPrefs.still
            ? { duration: 0 }
            : { duration: 0.8, ease: "easeOut" }
        }
      />
    </div>
  );
}

function AnimatedOutlet() {
  const motionPrefs = useMotionPrefs();
  const offset = motionPrefs.page === "fade" ? 0 : motionPrefs.distance;
  if (motionPrefs.still) {
    return (
      <div className="w-full">
        <Outlet />
      </div>
    );
  }
  return (
    <motion.div
      className="w-full"
      initial={{ opacity: 0, y: offset }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionPrefs.soft}
    >
      <Outlet />
    </motion.div>
  );
}

function NavLinks({ user }: { user: SessionUser }) {
  const { open, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !open && !isMobile;
  const path = useRouterState({ select: (state) => state.location.pathname });
  const resolved = useRouterState({
    select: (state) => state.resolvedLocation?.pathname,
  });
  const pending = useRouterState({
    select: (state) => state.status === "pending",
  });
  const here = pending ? resolved : (resolved ?? path);
  return (
    <nav aria-label={t("nav_main")} className="grid gap-1">
      {links
        .filter((link) => can({ role: user.role }, link.action))
        .map((link) => {
          const isPending = pending && path === link.to && here !== link.to;
          const Icon = link.icon;
          const item = (
            <Link
              to={link.to}
              activeOptions={{
                exact: link.to !== "/console/status-pages",
              }}
              aria-busy={isPending || undefined}
              data-pending={isPending ? "true" : undefined}
              onClick={() => setOpenMobile(false)}
              activeProps={{
                className: "bg-white/10 text-sidebar-foreground",
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground",
                collapsed && "justify-center px-0",
                isPending && "bg-white/10 text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className={cn("truncate", collapsed && "sr-only")}>
                {link.label()}
              </span>
            </Link>
          );
          if (!collapsed) return <div key={link.to}>{item}</div>;
          return (
            <Tooltip key={link.to}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent>{link.label()}</TooltipContent>
            </Tooltip>
          );
        })}
    </nav>
  );
}

function AccountMenu({ user }: { user: SessionUser }) {
  const { open, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !open && !isMobile;
  const client = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSubmitGuard();
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const initial = user.name.slice(0, 1).toUpperCase();

  return (
    <div className="grid gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5",
              collapsed && "justify-center px-0",
            )}
            aria-busy={signOut.pending || undefined}
          >
            <span className="sr-only">{t("nav_account_menu")}</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs">
              {initial}
            </span>
            <span className={cn("min-w-0", collapsed && "sr-only")}>
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block truncate text-xs text-sidebar-muted">
                {user.email}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          portalled={!isMobile}
          side={collapsed ? "right" : "top"}
          align="start"
        >
          <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/console/account" onClick={() => setOpenMobile(false)}>
              <CircleUser className="mr-2 h-4 w-4" aria-hidden />
              {t("nav_account")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              const next = dark ? "light" : "dark";
              document.documentElement.classList.toggle(
                "dark",
                next === "dark",
              );
              localStorage.setItem("theme", next);
              setDark(next === "dark");
            }}
          >
            <Sun className="mr-2 h-4 w-4" aria-hidden />
            {dark ? t("theme_light") : t("theme_dark")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={signOut.pending}
            onSelect={(event) => {
              event.preventDefault();
              void signOut.run(async () => {
                await api("/api/auth/logout", { method: "POST" });
                dropCachedSession(client);
                await navigate({ to: "/login" });
              });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            {signOut.pending ? t("action_working") : t("action_sign_out")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ShellFrame({ user }: { user: SessionUser }) {
  const { open, isMobile, setOpenMobile } = useSidebar();
  const collapsed = !open && !isMobile;
  const pending = useRouterState({
    select: (state) => state.status === "pending",
  });
  const routeKey = useRouterState({
    select: (state) => {
      const match = state.matches[state.matches.length - 1];
      if (!match) return "none";
      return `${match.routeId}:${JSON.stringify(match.params)}`;
    },
  });
  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <Link
            to="/console"
            onClick={() => setOpenMobile(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-1 py-1",
              collapsed && "justify-center",
            )}
          >
            <img src={logo} alt="" className="h-8 w-8" />
            <span
              className={cn("truncate font-medium", collapsed && "sr-only")}
            >
              {t("app_name")}
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <NavLinks user={user} />
        </SidebarContent>
        <SidebarFooter>
          <AccountMenu user={user} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <NavigationProgress />
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur md:px-4">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium md:hidden">
            {t("app_name")}
          </span>
        </header>
        <main className="relative flex-1 px-4 py-6 md:px-6" aria-busy={pending}>
          <AnimatedOutlet key={routeKey} />
        </main>
        <div className="px-4 pb-6 md:px-6">
          <AppFooter />
        </div>
      </SidebarInset>
    </>
  );
}

export function Shell({ user }: { user: SessionUser }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <ShellFrame user={user} />
      </SidebarProvider>
    </TooltipProvider>
  );
}
