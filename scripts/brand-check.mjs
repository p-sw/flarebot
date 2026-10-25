#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function gitStatus() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

const outside = [];
const contrastOnly = process.env.BRAND_CHECK_CONTRAST_ONLY === "1";
for (const line of gitStatus().split("\n")) {
  if (!line.trim()) continue;
  const file = line
    .slice(3)
    .trim()
    .replace(/^.* -> /, "");
  if (!file || file.startsWith("brand/") || file.startsWith(".brand-preview/"))
    continue;
  outside.push(file);
}
if (!contrastOnly && outside.length > 0) {
  console.error(
    "brand:check scope: these paths are outside brand/ (a rebrand must not touch them):",
  );
  for (const file of outside) console.error(`  ${file}`);
  process.exit(1);
}
if (gitStatus().trim() === "")
  console.log("brand:check scope skipped (clean tree)");

function oklchToLinear(value) {
  const match = /oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(value);
  if (!match) return null;
  const L = Number(match[1]);
  const C = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl].map((channel) => Math.min(1, Math.max(0, channel)));
}

function luminance(rgb) {
  if (!rgb) return 0;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(a, b) {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function palette(css, selector) {
  const block =
    selector === ":root"
      ? css.split(".dark")[0]
      : (css.split(".dark")[1] ?? "");
  const colors = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]+\))/g))
    colors[match[1]] = match[2];
  return colors;
}

const css = readFileSync("brand/tokens.css", "utf8");
const pairs = [
  ["foreground", "background"],
  ["primary-foreground", "primary"],
  ["muted-foreground", "background"],
  ["card-foreground", "card"],
  ["destructive-foreground", "destructive"],
  ["status-up-foreground", "background"],
  ["status-down-foreground", "background"],
  ["status-pending-foreground", "background"],
  ["status-unknown-foreground", "background"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-muted", "sidebar"],
];

let failed = false;
for (const mode of [":root", ".dark"]) {
  const colors = palette(css, mode);
  for (const [fg, bg] of pairs) {
    const ratio = contrast(
      oklchToLinear(colors[fg] ?? ""),
      oklchToLinear(colors[bg] ?? ""),
    );
    if (ratio < 4.5) {
      failed = true;
      console.error(
        `${mode} ${fg} on ${bg} is ${ratio.toFixed(2)}:1 (need 4.5:1)`,
      );
    }
  }
}
if (failed) process.exit(1);
console.log("contrast OK");

if (process.env.BRAND_CHECK_SKIP_BUILD === "1") process.exit(0);
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"], {
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.unit.config.ts"],
  { stdio: "inherit" },
);
