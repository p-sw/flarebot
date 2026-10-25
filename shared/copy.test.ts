// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime, formatMessage } from "./copy";

const real = JSON.parse(
  readFileSync(new URL("../brand/locale.json", import.meta.url), "utf8"),
) as { lang: string; messages: Record<string, string> };

describe("formatMessage", () => {
  it("keeps English plural categories and substitutes placeholders", () => {
    const template = real.messages.monitors_count ?? "";
    expect(formatMessage(template, { count: 1 }, "en")).toBe("1 monitor");
    expect(formatMessage(template, { count: 2 }, "en")).toBe("2 monitors");
    expect(
      formatMessage(
        "{name} is down. Reason: {reason}",
        {
          name: "API",
          reason: "timeout",
        },
        "en",
      ),
    ).toBe("API is down. Reason: timeout");
  });

  it("uses the locale tag for plural rules and dates", () => {
    const template = "{count, plural, one {# monitor} other {# monitors}}";
    expect(formatMessage(template, { count: 1 }, "ja")).toBe("1 monitors");
    const stamp = Date.UTC(2020, 0, 2, 15, 4);
    expect(formatDateTime(stamp, "en")).not.toBe(formatDateTime(stamp, "ja"));
  });
});

vi.mock("../brand/locale.json", async () => {
  const { readFileSync: read } = await import("node:fs");
  const catalog = JSON.parse(
    read(new URL("../brand/locale.json", import.meta.url), "utf8"),
  ) as { lang: string; messages: Record<string, string> };
  return {
    default: {
      lang: "ja",
      messages: {
        ...catalog.messages,
        status_all_operational: "All systems fixture",
        status_hero_tagline: "Fixture tagline",
        mail_test_subject: "Fixture mail {instance}",
        mail_test_body: "Fixture body {instance}",
      },
    },
  };
});

describe("swapped locale file", () => {
  it("changes status page UI and test email copy", async () => {
    const { default: StatusHero } = await import(
      "../brand/overrides/StatusHero"
    );
    const { testMail } = await import("../worker/notify/copy");
    const html = renderToStaticMarkup(
      createElement(StatusHero, {
        title: "API",
        description: "",
        banner: "",
        overall: "operational",
      }),
    );
    expect(html).toContain("All systems fixture");
    expect(html).toContain("Fixture tagline");
    expect(html).not.toContain("All systems operational");
    expect(testMail("Acme")).toEqual({
      subject: "Fixture mail Acme",
      text: "Fixture body Acme",
    });
  });
});
