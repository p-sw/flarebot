// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  badgeStatusFromRuntime,
  etagMatches,
  etagOf,
  layoutBadge,
  renderBadge,
  responseColor,
  statusColor,
  uptimeColor,
} from "./badge";
import {
  badgePageUrl,
  badgeQueryFrom,
  badgeSnippets,
  canonicalBadgePath,
  normalizeBadgeMonitorId,
  parseBadgeKind,
  sanitizeBadgeLabel,
} from "./badge-link";
import { measureHundredths } from "./badge-widths";

const corpus = [
  "i",
  "W",
  "status",
  "99.9%",
  "n/a",
  "response 24h",
  "A&B <tag>",
  "m".repeat(48),
  "★".repeat(8),
];

describe("badge text width", () => {
  it("measures W wider than i and ignores nothing inside ASCII", () => {
    expect(measureHundredths("W", "verdana11")).toBeGreaterThan(
      measureHundredths("i", "verdana11"),
    );
    expect(measureHundredths(" ", "verdana11")).toBeGreaterThan(0);
    expect(measureHundredths("★", "verdana11")).toBeGreaterThanOrEqual(
      measureHundredths("W", "verdana11"),
    );
  });

  it("keeps every glyph inside its section for every style", () => {
    for (const label of corpus) {
      for (const message of corpus) {
        for (const style of ["flat", "flat-square", "for-the-badge"] as const) {
          const layout = layoutBadge({ label, message, style });
          const svg = renderBadge({
            label,
            message,
            color: "#4c1",
            style,
          });
          expect(layout.left + layout.right).toBeCloseTo(layout.width, 5);
          expect(layout.labelTextWidth).toBeLessThanOrEqual(layout.left + 0.01);
          expect(layout.messageTextWidth).toBeLessThanOrEqual(
            layout.right + 0.01,
          );
          expect(svg).toContain(`width="${trim(layout.width)}"`);
          expect(svg).toContain(`height="${layout.height}"`);
          expect(svg).toContain("textLength=");
          expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
          if (style === "for-the-badge") {
            expect(svg).toContain(`>${escapeXml(label.toUpperCase())}<`);
            expect(svg).toContain(`>${escapeXml(message.toUpperCase())}<`);
          }
        }
      }
    }
  });

  it("escapes text that would break the SVG", () => {
    const svg = renderBadge({
      label: `<script>`,
      message: `a&b"c`,
      color: "#4c1",
      style: "flat",
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("a&amp;b&quot;c");
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('rx="3"');
  });

  it("draws flat square without a gradient or rounded clip", () => {
    const svg = renderBadge({
      label: "status",
      message: "up",
      color: "#4c1",
      style: "flat-square",
    });
    expect(svg).not.toContain("linearGradient");
    expect(svg).not.toContain("rx=");
    expect(svg).toContain('height="20"');
  });
});

describe("badge status and color", () => {
  it("maps runtime status onto the four public states", () => {
    expect(badgeStatusFromRuntime(true, "up")).toBe("paused");
    expect(badgeStatusFromRuntime(false, "up")).toBe("up");
    expect(badgeStatusFromRuntime(false, "down")).toBe("down");
    expect(badgeStatusFromRuntime(false, "pending")).toBe("degraded");
    expect(badgeStatusFromRuntime(false, "unknown")).toBe("degraded");
    expect(badgeStatusFromRuntime(false, null)).toBe("degraded");
    expect(statusColor("up")).toBe("#4c1");
    expect(statusColor("down")).toBe("#e05d44");
    expect(statusColor("paused")).toBe("#dfb317");
    expect(statusColor("degraded")).toBe("#fe7d37");
    expect(statusColor("unknown")).toBe("#9f9f9f");
  });

  it("colors uptime and response time by threshold", () => {
    expect(uptimeColor(null)).toBe("#9f9f9f");
    expect(uptimeColor(99.9)).toBe("#4c1");
    expect(uptimeColor(99)).toBe("#97ca00");
    expect(uptimeColor(95)).toBe("#a4a61d");
    expect(uptimeColor(90)).toBe("#dfb317");
    expect(uptimeColor(89.9)).toBe("#e05d44");
    expect(responseColor(null)).toBe("#9f9f9f");
    expect(responseColor(99)).toBe("#4c1");
    expect(responseColor(150)).toBe("#97ca00");
    expect(responseColor(250)).toBe("#dfb317");
    expect(responseColor(400)).toBe("#fe7d37");
    expect(responseColor(800)).toBe("#e05d44");
  });
});

describe("badge links", () => {
  it("canonicalizes the public path and ignores unknown query keys", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(normalizeBadgeMonitorId(id.toUpperCase())).toBe(id);
    expect(normalizeBadgeMonitorId("not-an-id")).toBeNull();
    expect(parseBadgeKind("uptime.svg")).toBe("uptime");
    expect(parseBadgeKind("nope.svg")).toBeNull();
    const query = badgeQueryFrom(
      new URLSearchParams("style=flat-square&window=7d&label=Edge&cachebust=1"),
    );
    expect(query).toEqual({
      style: "flat-square",
      window: "7d",
      label: "Edge",
    });
    expect(canonicalBadgePath(id, "uptime", query)).toBe(
      `/badge/${id}/uptime.svg?style=flat-square&window=7d&label=Edge`,
    );
    expect(
      canonicalBadgePath(id, "status", {
        style: "flat",
        window: "90d",
        label: null,
      }),
    ).toBe(`/badge/${id}/status.svg`);
    expect(
      badgeQueryFrom(new URLSearchParams("style=nope&window=nope")),
    ).toEqual({ style: "flat", window: "24h", label: null });
  });

  it("limits the label and builds escaped snippets", () => {
    expect(sanitizeBadgeLabel("  a\nb  ")).toBe("a b");
    expect(sanitizeBadgeLabel("w".repeat(60))).toHaveLength(48);
    expect(sanitizeBadgeLabel("\u0000")).toBeNull();
    const snippets = badgeSnippets({
      imageUrl: "https://status.example/badge/1/status.svg",
      pageUrl: "https://status.example/",
      alt: `Edge <main>`,
    });
    expect(snippets.html).toBe(
      '<img alt="Edge &lt;main&gt;" src="https://status.example/badge/1/status.svg">',
    );
    expect(snippets.markdown).toContain("](https://status.example/)");
    expect(
      badgePageUrl(
        "https://status.example",
        [
          { published: false, serveAtRoot: false, slug: "hidden" },
          { published: true, serveAtRoot: true, slug: "home" },
        ],
        "https://status.example/badge/1/status.svg",
      ),
    ).toBe("https://status.example/");
  });

  it("builds a stable etag", () => {
    const etag = etagOf("up");
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches(`W/${etag}`, etag)).toBe(true);
    expect(etagMatches(etagOf("down"), etag)).toBe(false);
    expect(etagOf("up")).toBe(etag);
  });
});

function trim(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
