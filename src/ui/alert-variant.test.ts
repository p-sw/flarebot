// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { incidentAlertVariant } from "./alert-variant";

describe("incidentAlertVariant", () => {
  it("uses destructive for an investigating incident or a major outage", () => {
    expect(incidentAlertVariant("investigating")).toBe("destructive");
    expect(incidentAlertVariant("identified", "major_outage")).toBe(
      "destructive",
    );
    expect(
      incidentAlertVariant("monitoring", null, [{ impact: "major_outage" }]),
    ).toBe("destructive");
    expect(incidentAlertVariant("down")).toBe("destructive");
  });

  it("uses warning for degraded, partial, identified, and monitoring incidents", () => {
    expect(incidentAlertVariant("identified", "degraded")).toBe("warning");
    expect(incidentAlertVariant("monitoring", "partial_outage")).toBe(
      "warning",
    );
    expect(incidentAlertVariant("degraded")).toBe("warning");
    expect(incidentAlertVariant("pending")).toBe("warning");
  });

  it("uses maintenance for a maintenance signal and default once resolved", () => {
    expect(incidentAlertVariant("maintenance")).toBe("maintenance");
    expect(incidentAlertVariant("resolved")).toBe("default");
    expect(incidentAlertVariant("up")).toBe("default");
  });
});

type Lab = [number, number, number];

function oklchToLab(value: string): Lab | null {
  const match = /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(value);
  if (!match) return null;
  const hue = (Number(match[3]) * Math.PI) / 180;
  const chroma = Number(match[2]);
  return [Number(match[1]), chroma * Math.cos(hue), chroma * Math.sin(hue)];
}

function luminance([lightness, a, b]: Lab): number {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: Lab, background: Lab): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function declarations(block: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    values[match[1]] = match[2].replace(/\s+/g, " ").trim();
  }
  return values;
}

describe("alert surfaces", () => {
  const theme = declarations(
    readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8"),
  );
  const tokens = readFileSync(
    new URL("../../brand/tokens.css", import.meta.url),
    "utf8",
  );
  const modes = {
    light: declarations(tokens.split(".dark")[0]),
    dark: declarations(tokens.split(".dark")[1] ?? ""),
  };
  const surfaces = [
    "alert-default",
    "alert-destructive",
    "alert-warning",
    "alert-maintenance",
  ];

  function token(mode: Record<string, string>, name: string): Lab {
    const lab = oklchToLab(mode[name] ?? "");
    if (!lab) throw new Error(`${name} is not an oklch token`);
    return lab;
  }

  // A surface is either a brand token or a light tint of one over the card.
  function surface(mode: Record<string, string>, value: string): Lab {
    const plain = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (plain) return token(mode, plain[1]);
    const mix =
      /^color-mix\(in oklab, var\(--([a-z0-9-]+)\) ([0-9.]+)%, var\(--card\)\)$/.exec(
        value,
      );
    if (!mix) throw new Error(`Unexpected alert surface: ${value}`);
    const share = Number(mix[2]) / 100;
    expect(share, value).toBeLessThanOrEqual(0.15);
    const tint = token(mode, mix[1]);
    const card = token(mode, "card");
    return [0, 1, 2].map(
      (index) => tint[index] * share + card[index] * (1 - share),
    ) as Lab;
  }

  it("keeps alert text on the page foreground over a light tint at WCAG AA", () => {
    expect(theme["alert-foreground"]).toBe("var(--foreground)");
    for (const [label, mode] of Object.entries(modes)) {
      for (const name of surfaces) {
        const fill = surface(mode, theme[name] ?? "");
        expect(
          contrast(token(mode, "foreground"), fill),
          `${name} ${label}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("tints only the alert icon, never the alert copy", () => {
    const sources = ["alert.tsx", "../pages/status-notice.tsx"].map((file) =>
      readFileSync(new URL(file, import.meta.url), "utf8"),
    );
    const coloured =
      /text-(destructive|primary|muted|status-|foreground|card-foreground)/;
    for (const source of sources) {
      expect(source.replaceAll("[&>svg]:text-", "")).not.toMatch(coloured);
    }
  });
});
