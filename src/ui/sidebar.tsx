// SPDX-License-Identifier: MIT

import * as Dialog from "@radix-ui/react-dialog";
import { useRouterState } from "@tanstack/react-router";
import { Menu, PanelLeft, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { cn } from "../lib/cn";
import { useMotionPrefs } from "../motion/page";
import { m } from "../paraglide/messages.js";
import { Button } from "./button";

const STORAGE_KEY = "sidebar-open";
const MOBILE_QUERY = "(max-width: 767px)";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value)
    throw new Error("Sidebar components must render inside SidebarProvider");
  return value;
}

function readOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(MOBILE_QUERY).matches
      : false,
  );
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [open, setOpenState] = useState(readOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    if (pathname) setOpenMobile(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if (isMobile) setOpenMobile((value) => !value);
      else {
        setOpenState((value) => {
          const next = !value;
          try {
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          } catch {
            // Ignore storage failures.
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile]);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage can be unavailable. The in-memory state still toggles.
    }
  };

  const toggle = () => {
    if (isMobile) setOpenMobile((value) => !value);
    else setOpen(!open);
  };

  return (
    <SidebarContext.Provider
      value={{ open, setOpen, openMobile, setOpenMobile, isMobile, toggle }}
    >
      <div className="flex min-h-svh w-full">{children}</div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children }: { children: ReactNode }) {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();
  const motionPrefs = useMotionPrefs();
  if (isMobile) {
    return (
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Dialog.Portal forceMount>
          <AnimatePresence>
            {openMobile ? (
              <Dialog.Overlay key="nav-overlay" asChild forceMount>
                <motion.div
                  data-testid="nav-overlay"
                  className="fixed inset-0 z-50 bg-black/50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionPrefs.drawer}
                />
              </Dialog.Overlay>
            ) : null}
            {openMobile ? (
              <Dialog.Content
                key="nav-sheet"
                asChild
                forceMount
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                  const panel = event.currentTarget;
                  if (!(panel instanceof HTMLElement)) return;
                  const link = panel.querySelector("a");
                  if (link instanceof HTMLElement) {
                    event.preventDefault();
                    link.focus();
                  }
                }}
              >
                <motion.div
                  id="admin-sidebar"
                  className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2.5rem))] flex-col bg-sidebar text-sidebar-foreground shadow-lg outline-none"
                  initial={motionPrefs.still ? { x: 0 } : { x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={
                    motionPrefs.still ? { x: 0, opacity: 0 } : { x: "-100%" }
                  }
                  transition={motionPrefs.drawer}
                >
                  <Dialog.Title className="sr-only">
                    {m.nav_main()}
                  </Dialog.Title>
                  {children}
                </motion.div>
              </Dialog.Content>
            ) : null}
          </AnimatePresence>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <aside
      id="admin-sidebar"
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground md:flex",
        open ? "w-64" : "w-16",
      )}
      style={{
        transitionProperty: "width",
        transitionDuration: `${motionPrefs.sidebarMs}ms`,
        transitionTimingFunction: "ease-out",
      }}
      data-state={open ? "expanded" : "collapsed"}
      data-collapsible={open ? "" : "icon"}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({ children }: { children: ReactNode }) {
  const { isMobile } = useSidebar();
  return (
    <div className="flex items-center gap-2 px-3 py-4">
      <div className="min-w-0 flex-1">{children}</div>
      {isMobile ? (
        <Dialog.Close asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-sidebar-foreground hover:bg-white/10"
            aria-label={m.nav_close_menu()}
          >
            <X className="h-4 w-4" />
          </Button>
        </Dialog.Close>
      ) : null}
    </div>
  );
}

export function SidebarContent({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-2 pb-4">{children}</div>;
}

export function SidebarFooter({ children }: { children: ReactNode }) {
  return <div className="mt-auto border-t border-white/10 p-2">{children}</div>;
}

export function SidebarInset({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", className)}>
      {children}
    </div>
  );
}

export function SidebarTrigger() {
  const { isMobile, open, openMobile, toggle } = useSidebar();
  const label = isMobile
    ? openMobile
      ? m.nav_close_menu()
      : m.nav_open_menu()
    : open
      ? m.nav_collapse()
      : m.nav_expand();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-expanded={isMobile ? openMobile : open}
      aria-controls="admin-sidebar"
      onClick={toggle}
    >
      <Menu className="h-5 w-5 md:hidden" aria-hidden />
      <PanelLeft className="hidden h-5 w-5 md:block" aria-hidden />
    </Button>
  );
}
