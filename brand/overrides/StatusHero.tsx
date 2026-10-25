// SPDX-License-Identifier: MIT

import { m } from "../../src/paraglide/messages.js";

export default function StatusHero({
  title,
  description,
  banner,
  overall,
}: {
  title: string;
  description: string;
  banner: string;
  overall: "operational" | "degraded" | "outage" | "empty";
}) {
  const label =
    overall === "outage"
      ? m.status_all_down()
      : overall === "degraded"
        ? m.status_some_down()
        : overall === "empty"
          ? m.status_empty()
          : m.status_all_operational();
  const tone =
    overall === "outage" || overall === "degraded"
      ? "bg-status-down"
      : overall === "empty"
        ? "bg-status-unknown"
        : "bg-status-up";
  return (
    <section className="rounded-lg border border-border bg-card p-8">
      <p className="text-sm text-muted-foreground">{m.status_hero_tagline()}</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">{title}</h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>
      ) : null}
      <p className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
        {label}
      </p>
      {banner ? (
        <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm">{banner}</p>
      ) : null}
    </section>
  );
}
