// SPDX-License-Identifier: MIT

import {
  BADGE_KINDS,
  BADGE_STYLES,
  type BadgeKind,
  type BadgeStyle,
  type BadgeWindow,
  badgePageUrl,
  badgeQueryFrom,
  badgeSnippets,
  canonicalBadgePath,
  sanitizeBadgeLabel,
} from "@shared/badge-link";
import { t } from "@shared/copy";
import { can, type Role } from "@shared/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ApiClientError, api } from "../lib/api";
import { cn } from "../lib/cn";
import type { MonitorDetail } from "../lib/queries";
import { commitMonitor } from "../lib/query-sync";
import { sessionCacheKey } from "../lib/session-gate";
import { useToggleLock } from "../lib/toggle-guard";
import { useMotionPrefs } from "../motion/page";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

const WINDOWS: BadgeWindow[] = ["24h", "7d", "30d", "90d"];

const STYLE_LABEL: Record<BadgeStyle, () => string> = {
  flat: () => t("badge_style_flat"),
  "flat-square": () => t("badge_style_flat_square"),
  "for-the-badge": () => t("badge_style_for_the_badge"),
};

const KIND_LABEL: Record<BadgeKind, () => string> = {
  status: () => t("badge_kind_status"),
  uptime: () => t("badge_kind_uptime"),
  response: () => t("badge_kind_response"),
};

const WINDOW_LABEL: Record<BadgeWindow, () => string> = {
  "24h": () => t("range_24h"),
  "7d": () => t("range_7d"),
  "30d": () => t("range_30d"),
  "90d": () => t("range_90d"),
};

function defaultLabel(
  kind: BadgeKind,
  window: BadgeWindow,
  custom: string | null,
) {
  if (custom) return custom;
  if (kind === "status") return t("badge_label_status");
  if (kind === "uptime") return t("badge_label_uptime", { window });
  return t("badge_label_response", { window });
}

export function MonitorBadges({ monitor }: { monitor: MonitorDetail }) {
  const client = useQueryClient();
  const motionPrefs = useMotionPrefs();
  const toggles = useToggleLock();
  const session = useQuery({
    queryKey: sessionCacheKey(),
    queryFn: () => api<{ user: { role: Role } | null }>("/api/auth/session"),
    staleTime: 60_000,
  });
  const canWrite = session.data?.user
    ? can({ role: session.data.user.role }, "monitors.write")
    : false;
  const [style, setStyle] = useState<BadgeStyle>("flat");
  const [windowRange, setWindowRange] = useState<BadgeWindow>("24h");
  const [label, setLabel] = useState("");
  const [previewLabel, setPreviewLabel] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [broken, setBroken] = useState<Partial<Record<BadgeKind, boolean>>>({});
  const pending = toggles.pendingKey === "badges";
  const custom = sanitizeBadgeLabel(label);

  useEffect(() => {
    const timer = setTimeout(() => setPreviewLabel(label), 200);
    return () => clearTimeout(timer);
  }, [label]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const previewQuery = badgeQueryFrom(
    new URLSearchParams({
      style,
      window: windowRange,
      ...(sanitizeBadgeLabel(previewLabel)
        ? { label: sanitizeBadgeLabel(previewLabel) ?? "" }
        : {}),
    }),
  );

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setCopied("");
    }
  }

  return (
    <Card className="mb-4 min-w-0">
      <CardHeader>
        <CardTitle>{t("badge_title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("badge_intro")}</p>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="mb-4 min-w-0 rounded-lg border border-border p-3">
          <div className="min-w-0">
            {/* The switch is the labeled control. */}
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
            <label className="flex min-w-0 items-start gap-3">
              <Switch
                id="badge-toggle"
                checked={monitor.badgesEnabled}
                disabled={!canWrite || pending}
                aria-busy={pending || undefined}
                aria-describedby="badge-toggle-help"
                className="mt-0.5 disabled:opacity-50"
                onCheckedChange={(enabled) => {
                  if (!canWrite || pending) return;
                  void toggles.run("badges", async () => {
                    setError("");
                    try {
                      const saved = await api<MonitorDetail>(
                        `/api/monitors/${monitor.id}/badges`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({ enabled }),
                        },
                      );
                      commitMonitor(client, saved);
                    } catch (caught) {
                      setError(
                        caught instanceof ApiClientError
                          ? caught.message
                          : t("error_internal"),
                      );
                    }
                  });
                }}
              />
              <span className="min-w-0 text-sm">{t("badge_toggle")}</span>
            </label>
            <div className="min-w-0">
              <p
                id="badge-toggle-help"
                className="mt-1 text-sm text-muted-foreground"
              >
                {t("badge_toggle_help")}
              </p>
              {pending ? (
                <p
                  role="status"
                  className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("badge_toggle_busy")}
                </p>
              ) : null}
              {!canWrite ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("badge_toggle_readonly")}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-sm">
            {monitor.badgesPublic
              ? monitor.badgesEnabled
                ? t("badge_public_switch")
                : t("badge_public_page")
              : t("badge_private")}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mb-4 grid min-w-0 gap-4">
          <fieldset className="min-w-0" aria-describedby="badge-style-help">
            <legend className="mb-1 text-sm font-medium">
              {t("badge_style")}
            </legend>
            <p
              id="badge-style-help"
              className="mb-2 text-sm text-muted-foreground"
            >
              {t("badge_style_help")}
            </p>
            <div className="flex min-w-0 flex-wrap gap-1">
              {BADGE_STYLES.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={style === item}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    style === item
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                  onClick={() => setStyle(item)}
                >
                  {STYLE_LABEL[item]()}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0" aria-describedby="badge-window-help">
            <legend className="mb-1 text-sm font-medium">
              {t("badge_window")}
            </legend>
            <p
              id="badge-window-help"
              className="mb-2 text-sm text-muted-foreground"
            >
              {t("badge_window_help")}
            </p>
            <div className="flex min-w-0 flex-wrap gap-1">
              {WINDOWS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={windowRange === item}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    windowRange === item
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                  onClick={() => setWindowRange(item)}
                >
                  {WINDOW_LABEL[item]()}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="min-w-0">
            <Label htmlFor="badge-label">{t("badge_label")}</Label>
            <p
              id="badge-label-help"
              className="mb-2 text-sm text-muted-foreground"
            >
              {t("badge_label_help")}
            </p>
            <Input
              id="badge-label"
              value={label}
              maxLength={48}
              aria-describedby="badge-label-help"
              placeholder={t("badge_label_placeholder")}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          {t("badge_cache_note")}
        </p>
        <div className="grid min-w-0 gap-3">
          {BADGE_KINDS.map((kind) => {
            const query = badgeQueryFrom(
              new URLSearchParams({
                style,
                window: windowRange,
                ...(custom ? { label: custom } : {}),
              }),
            );
            const path = canonicalBadgePath(monitor.id, kind, query);
            const imageUrl = `${origin}${path}`;
            const pageUrl = badgePageUrl(origin, monitor.statusPages, imageUrl);
            const alt = t("badge_alt", {
              label: defaultLabel(kind, windowRange, custom),
            });
            const snippets = badgeSnippets({ imageUrl, pageUrl, alt });
            const preview = new URLSearchParams({
              kind,
              style: previewQuery.style,
              tick: String(monitor.updatedAt),
            });
            if (kind !== "status") preview.set("window", previewQuery.window);
            if (previewQuery.label) preview.set("label", previewQuery.label);
            const src = `/api/monitors/${monitor.id}/badges/preview.svg?${preview.toString()}`;
            return (
              <div
                key={kind}
                className="min-w-0 rounded-lg border border-border p-3"
              >
                <p className="mb-2 text-sm font-medium">{KIND_LABEL[kind]()}</p>
                <div className="mb-3 flex min-h-12 min-w-0 items-center overflow-hidden rounded-md bg-muted px-3 py-2">
                  {broken[kind] ? (
                    <p className="text-sm text-muted-foreground">
                      {t("badge_open_failed")}
                    </p>
                  ) : (
                    <motion.img
                      key={src}
                      src={src}
                      alt={t("badge_preview", { kind: KIND_LABEL[kind]() })}
                      className="max-w-full"
                      initial={
                        motionPrefs.still
                          ? false
                          : { opacity: 0, y: motionPrefs.distance }
                      }
                      animate={{ opacity: 1, y: 0 }}
                      transition={motionPrefs.snappy}
                      onLoad={() =>
                        setBroken((current) => ({ ...current, [kind]: false }))
                      }
                      onError={() =>
                        setBroken((current) => ({ ...current, [kind]: true }))
                      }
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {(
                    [
                      ["url", t("badge_copy_url"), snippets.url],
                      ["markdown", t("badge_copy_markdown"), snippets.markdown],
                      ["html", t("badge_copy_html"), snippets.html],
                    ] as const
                  ).map(([name, text, value]) => {
                    const key = `${kind}-${name}`;
                    return (
                      <Button
                        key={name}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copy(value, key)}
                      >
                        {copied === key ? t("copied") : text}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
