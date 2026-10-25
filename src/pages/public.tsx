// SPDX-License-Identifier: MIT

import AppFooter from "@brand/overrides/AppFooter";
import StatusHero from "@brand/overrides/StatusHero";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Badge } from "@/ui/badge";
import { api } from "../lib/api";
import { m } from "../paraglide/messages.js";
import { setLocale } from "../paraglide/runtime.js";
import { statusTone } from "./fields";

type PublicPage = {
  title: string;
  description: string;
  footer: string;
  banner: string;
  locale: string;
  locales: string[];
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
  if (status === "up") return m.status_up();
  if (status === "down") return m.status_down();
  if (status === "pending") return m.status_pending();
  if (status === "paused") return m.status_paused();
  return m.status_unknown();
}

export function PublicStatusPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const lang = new URLSearchParams(window.location.search).get("lang");
  const page = useQuery({
    queryKey: ["public", slug, lang],
    queryFn: () =>
      api<PublicPage>(
        `/api/public/status/${slug}${lang ? `?lang=${lang}` : ""}`,
      ),
  });
  const data = page.data;
  if (!data) return <p className="p-8">{m.loading()}</p>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {data.locales.length > 1 ? (
        <div className="mb-4 flex justify-end gap-2 text-sm">
          {data.locales.map((locale) => (
            <button
              key={locale}
              type="button"
              className={
                locale === data.locale ? "font-medium" : "text-muted-foreground"
              }
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("lang", locale);
                window.history.replaceState({}, "", url);
                void setLocale(locale as "en" | "ko");
                window.location.assign(url);
              }}
            >
              {locale === "ko" ? m.language_ko() : m.language_en()}
            </button>
          ))}
        </div>
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
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">{item.name}</h3>
                    <Badge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.range_90d()}{" "}
                    {item.uptime90 === null ? "—" : `${item.uptime90}%`}
                  </p>
                  <div
                    className="mt-3 flex h-6 items-end gap-px"
                    aria-hidden="true"
                  >
                    {item.bars.map((bar) => (
                      <div
                        key={bar.day}
                        title={bar.uptime === null ? "" : `${bar.uptime}%`}
                        className={
                          bar.uptime === null
                            ? "bg-muted"
                            : bar.uptime >= 99
                              ? "bg-status-up"
                              : bar.uptime >= 90
                                ? "bg-status-pending"
                                : "bg-status-down"
                        }
                        style={{ height: 16, width: 3 }}
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
