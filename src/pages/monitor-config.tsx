// SPDX-License-Identifier: MIT

import { formatDateTime, t } from "@shared/copy";
import {
  isSensitiveHeader,
  maskHeaderValue,
  monitorTargetLabel,
} from "@shared/monitor-draft";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { channelsQuery, type MonitorDetail } from "../lib/queries";
import { useMotionPrefs } from "../motion/page";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { monitorTypeLabel } from "./monitor-labels";

export function MonitorConfig({ monitor }: { monitor: MonitorDetail }) {
  const channels = useQuery(channelsQuery);
  const config = monitor.config ?? {};
  const headers = headerRows(config.headers);
  const sensitive = headers.some((header) => isSensitiveHeader(header.name));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState("");
  const target =
    monitor.target ||
    monitorTargetLabel(monitor.type, config) ||
    monitor.pushUrl ||
    "";
  const names = new Map(
    (channels.data?.channels ?? []).map((channel) => [
      channel.id,
      channel.name,
    ]),
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
        <CardTitle>{t("monitor_check")}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        <dl className="min-w-0">
          <Row label={t("monitor_type")}>{monitorTypeLabel(monitor.type)}</Row>
          <Row label={t("monitor_target")}>
            {target ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-all font-mono">{target}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(target, "target")}
                >
                  {copied === "target" ? t("copied") : t("action_copy")}
                </Button>
              </div>
            ) : (
              t("monitor_not_set")
            )}
          </Row>
          {monitor.type === "http" ? (
            <>
              <Row label={t("monitor_method")}>
                {text(config.method, "GET")}
              </Row>
              <Row label={t("monitor_expected_status")}>
                {list(config.expectedStatuses)}
              </Row>
              <Row label={t("monitor_keyword")}>{text(config.keyword)}</Row>
              <Row label={t("monitor_keyword_mode")}>
                {config.keywordMode === "absent"
                  ? t("monitor_keyword_absent")
                  : t("monitor_keyword_present")}
              </Row>
              <Row label={t("monitor_json_path")}>{text(config.jsonPath)}</Row>
              <Row label={t("monitor_json_expect")}>
                {text(config.jsonExpect)}
              </Row>
              <Row label={t("monitor_follow")}>
                {config.followRedirects === false
                  ? t("monitor_no")
                  : t("monitor_yes")}
              </Row>
              <Row label={t("monitor_headers")}>
                {headers.length === 0 ? (
                  t("monitor_not_set")
                ) : (
                  <div className="grid min-w-0 gap-2">
                    {headers.map((header) => {
                      const hidden =
                        isSensitiveHeader(header.name) && !revealed;
                      return (
                        <div
                          key={header.key}
                          className="flex min-w-0 flex-wrap gap-x-3 gap-y-1"
                        >
                          <span className="font-mono">{header.name}</span>
                          <SecretValue
                            value={
                              hidden
                                ? maskHeaderValue(header.value)
                                : header.value
                            }
                            hidden={hidden}
                          />
                        </div>
                      );
                    })}
                    {sensitive ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRevealed((current) => !current)}
                      >
                        {revealed ? t("monitor_hide") : t("monitor_reveal")}
                      </Button>
                    ) : null}
                  </div>
                )}
              </Row>
              <Row label={t("monitor_body")}>
                {text(config.body) === t("monitor_not_set") ? (
                  t("monitor_not_set")
                ) : (
                  <pre className="m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                    {text(config.body)}
                  </pre>
                )}
              </Row>
            </>
          ) : null}
          {monitor.type === "tcp" || monitor.type === "ssl" ? (
            <Row label={t("monitor_host")}>{text(config.host)}</Row>
          ) : null}
          {monitor.type === "tcp" ? (
            <Row label={t("monitor_port")}>{text(config.port)}</Row>
          ) : null}
          {monitor.type === "dns" ? (
            <>
              <Row label={t("monitor_dns_name")}>{text(config.name)}</Row>
              <Row label={t("monitor_dns_type")}>{text(config.type)}</Row>
              <Row label={t("monitor_dns_expected")}>
                {list(config.expected)}
              </Row>
              <Row label={t("monitor_resolver")}>{text(config.resolver)}</Row>
            </>
          ) : null}
          {monitor.type === "ssl" ? (
            <Row label={t("monitor_ssl_warn")}>{text(config.warnDays)}</Row>
          ) : null}
          {monitor.type === "heartbeat" ? (
            <Row label={t("monitor_grace")}>{text(config.graceSeconds)}</Row>
          ) : null}
          <Row label={t("monitor_interval")}>
            {String(monitor.intervalSeconds)}
          </Row>
          <Row label={t("monitor_timeout")}>
            {String(monitor.timeoutSeconds)}
          </Row>
          <Row label={t("monitor_retries")}>{String(monitor.retries)}</Row>
          <Row label={t("monitor_recovery")}>
            {String(monitor.recoveryThreshold)}
          </Row>
          <Row label={t("monitor_regions")}>
            {monitor.regions.length > 0
              ? monitor.regions.join(", ")
              : t("monitor_not_set")}
          </Row>
          <Row label={t("monitor_channels")}>
            {monitor.channelIds.length === 0 ? (
              t("monitor_no_channels")
            ) : (
              <ul className="grid min-w-0 gap-1">
                {monitor.channelIds.map((id) => (
                  <li key={id} className="break-words">
                    {names.get(id) ?? t("monitor_channel_missing")}
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row label={t("monitor_status_pages")}>
            {monitor.statusPages.length === 0 ? (
              t("monitor_no_pages")
            ) : (
              <ul className="grid min-w-0 gap-1">
                {monitor.statusPages.map((page) => (
                  <li key={page.id} className="min-w-0">
                    <Link
                      to="/console/status-pages/$id"
                      params={{ id: page.id }}
                      className="break-words underline-offset-2 hover:underline"
                    >
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row label={t("monitor_created")}>
            {formatDateTime(monitor.createdAt)}
          </Row>
          <Row label={t("monitor_updated")}>
            {formatDateTime(monitor.updatedAt)}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}

function SecretValue({ value, hidden }: { value: string; hidden: boolean }) {
  const motionPrefs = useMotionPrefs();
  return (
    <motion.span
      key={hidden ? "hidden" : "shown"}
      className="min-w-0 break-all font-mono"
      initial={
        motionPrefs.still ? false : { opacity: 0, y: motionPrefs.distance }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={motionPrefs.snappy}
    >
      {value}
    </motion.span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  if (fallback) return fallback;
  return t("monitor_not_set");
}

function list(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return t("monitor_not_set");
  return value.map((item) => String(item)).join(", ");
}

function headerRows(
  value: unknown,
): { key: string; name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, number>();
  return value.flatMap((header) => {
    if (!header || typeof header !== "object") return [];
    const row = header as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "";
    const headerValue = typeof row.value === "string" ? row.value : "";
    if (!name) return [];
    const base = `${name}:${headerValue}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [{ key: `${base}:${count}`, name, value: headerValue }];
  });
}
