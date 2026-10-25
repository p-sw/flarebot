// SPDX-License-Identifier: MIT

import AppFooter from "@brand/overrides/AppFooter";
import StatusHero from "@brand/overrides/StatusHero";
import { isSupportedLocale } from "@shared/locales";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Badge } from "@/ui/badge";
import { api } from "../lib/api";
import { useSubmitGuard } from "../lib/use-submit-guard";
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
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = params.slug;
  const lang = new URLSearchParams(window.location.search).get("lang");
  const switching = useSubmitGuard();
  const query = lang ? `?lang=${lang}` : "";
  const page = useQuery({
    queryKey: ["public", slug ?? "root", lang],
    queryFn: () =>
      api<PublicPage>(
        slug
          ? `/api/public/status/${slug}${query}`
          : `/api/public/root${query}`,
      ),
  });
  const data = page.data;
  if (!data) return <p className="p-8">{m.loading()}</p>;
  return (
    <div className="mx-auto min-w-0 max-w-3xl px-4 py-10">
      {data.locales.length > 1 ? (
        <div className="mb-4 flex flex-wrap justify-end gap-2 text-sm">
          {data.locales.map((locale) => (
            <button
              key={locale}
              type="button"
              disabled={switching.pending || !isSupportedLocale(locale)}
              aria-pressed={locale === data.locale}
              className={
                locale === data.locale ? "font-medium" : "text-muted-foreground"
              }
              onClick={() => {
                if (!isSupportedLocale(locale)) return;
                void switching.run(async () => {
                  await setLocale(locale);
                  try {
                    await api("/api/account", {
                      method: "PATCH",
                      body: JSON.stringify({ locale }),
                    });
                  } catch {
                    // Public visitors are not signed in. The cookie still records the choice.
                  }
                  const url = new URL(window.location.href);
                  url.searchParams.set("lang", locale);
                  window.location.assign(url.toString());
                });
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
                  className="min-w-0 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <h3 className="min-w-0 break-words font-medium">
                      {item.name}
                    </h3>
                    <Badge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.range_90d()}{" "}
                    {item.uptime90 === null ? "—" : `${item.uptime90}%`}
                  </p>
                  <div
                    className="mt-3 flex h-6 min-w-0 items-end gap-px"
                    aria-hidden="true"
                  >
                    {item.bars.map((bar) => (
                      <div
                        key={bar.day}
                        title={bar.uptime === null ? "" : `${bar.uptime}%`}
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
