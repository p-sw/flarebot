// SPDX-License-Identifier: MIT

import AppFooter from "@brand/overrides/AppFooter";
import StatusHero from "@brand/overrides/StatusHero";
import { t } from "@shared/copy";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Badge } from "@/ui/badge";
import { api } from "../lib/api";
import { statusTone } from "./fields";

type PublicPage = {
  title: string;
  description: string;
  footer: string;
  banner: string;
  logoUrl?: string | null;
  accent?: string | null;
  overall: "operational" | "degraded" | "outage" | "empty";
  groups: {
    name: string;
    items: {
      id: string;
      name: string;
      status: string;
      uptime90: number | null;
      bars: { day: number; uptime: number | null }[];
    }[];
  }[];
};

function statusLabel(status: string) {
  if (status === "up") return t("status_up");
  if (status === "down") return t("status_down");
  if (status === "pending") return t("status_pending");
  if (status === "paused") return t("status_paused");
  return t("status_unknown");
}

export function PublicStatusPage() {
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = params.slug;
  const page = useQuery({
    queryKey: ["public", slug ?? "root"],
    queryFn: () =>
      api<PublicPage>(slug ? `/api/public/status/${slug}` : "/api/public/root"),
  });
  const data = page.data;
  if (!data) return <p className="p-8">{t("loading")}</p>;
  return (
    <div className="mx-auto min-w-0 max-w-3xl px-4 py-10">
      {data.logoUrl ? (
        <img
          src={data.logoUrl}
          alt=""
          className="mb-4 h-10 max-w-full object-contain"
        />
      ) : null}
      {data.accent && /^#[0-9a-fA-F]{6}$/.test(data.accent) ? (
        <div
          className="mb-4 h-1 w-16 rounded-full"
          style={{ backgroundColor: data.accent }}
        />
      ) : null}
      <StatusHero
        title={data.title}
        description={data.description}
        banner={data.banner}
        overall={data.overall}
      />
      <div className="mt-8 grid gap-6">
        {data.groups.map((group) => (
          <section key={group.name || "default"}>
            {group.name ? (
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {group.name}
              </h2>
            ) : null}
            <div className="grid gap-3">
              {group.items.map((item) => (
                <article
                  key={item.id}
                  className="min-w-0 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <h3 className="min-w-0 break-words font-medium">
                      {item.name || t("monitor_fallback_name")}
                    </h3>
                    <Badge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("range_90d")}{" "}
                    {item.uptime90 === null
                      ? t("uptime_empty")
                      : t("uptime_percent", { value: item.uptime90 })}
                  </p>
                  <div
                    className="mt-3 flex h-6 min-w-0 items-end gap-px"
                    aria-hidden="true"
                  >
                    {item.bars.map((bar) => (
                      <div
                        key={bar.day}
                        title={
                          bar.uptime === null
                            ? ""
                            : t("uptime_percent", { value: bar.uptime })
                        }
                        className={`min-w-0 flex-1 ${
                          bar.uptime === null
                            ? "bg-muted"
                            : bar.uptime >= 99
                              ? "bg-status-up"
                              : bar.uptime >= 90
                                ? "bg-status-pending"
                                : "bg-status-down"
                        }`}
                        style={{ height: 16 }}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {data.footer ? (
        <p className="mt-8 text-sm text-muted-foreground">{data.footer}</p>
      ) : null}
      <AppFooter />
    </div>
  );
}
