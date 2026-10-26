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

function oklchToLinear(value: string): number[] | null {
  const match = /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(value);
  if (!match) return null;
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [red, green, blue];
}

function luminance(rgb: number[]): number {
  const [red, green, blue] = rgb.map((channel) =>
    Math.min(1, Math.max(0, channel)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: number[], background: number[]): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function palette(css: string, mode: ":root" | ".dark"): Record<string, string> {
  const block =
    mode === ":root" ? css.split(".dark")[0] : (css.split(".dark")[1] ?? "");
  const colors: Record<string, string> = {};
  for (const match of block.matchAll(/--(alert-[a-z0-9-]+):\s*([^;]+);/g)) {
    colors[match[1]] = match[2].trim();
  }
  return colors;
}

describe("alert surfaces", () => {
  const css = readFileSync(
    new URL("../styles/theme.css", import.meta.url),
    "utf8",
  );
  const surfaces = [
    "alert-default",
    "alert-destructive",
    "alert-warning",
    "alert-maintenance",
  ];

  it("keeps alert text black on light fills and white on dark fills at WCAG AA", () => {
    const light = palette(css, ":root");
    const dark = palette(css, ".dark");
    expect(light["alert-foreground"]).toBe("#000000");
    expect(dark["alert-foreground"]).toBe("#ffffff");
    for (const name of surfaces) {
      const lightFill = oklchToLinear(light[name] ?? "");
      const darkFill = oklchToLinear(dark[name] ?? "");
      expect(lightFill, name).not.toBeNull();
      expect(darkFill, name).not.toBeNull();
      expect(
        lightFill?.every((channel) => channel >= -0.001 && channel <= 1.001),
        `${name} light is outside sRGB`,
      ).toBe(true);
      expect(
        darkFill?.every((channel) => channel >= -0.001 && channel <= 1.001),
        `${name} dark is outside sRGB`,
      ).toBe(true);
      expect(contrast([0, 0, 0], lightFill ?? [])).toBeGreaterThanOrEqual(4.5);
      expect(contrast([1, 1, 1], darkFill ?? [])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not paint alert copy in a coloured text tone", () => {
    const sources = ["alert.tsx", "../pages/status-notice.tsx"].map((file) =>
      readFileSync(new URL(file, import.meta.url), "utf8"),
    );
    const coloured =
      /text-(destructive|primary|muted|status-|foreground|card-foreground)/;
    for (const source of sources) expect(source).not.toMatch(coloured);
  });
});
