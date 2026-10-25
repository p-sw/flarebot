#!/usr/bin/env node
// Fails when repository text contains a non-Latin script.
// brand/locale.json is the one file a deployment may translate.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const nonLatin =
  /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Greek}|\p{Script=Devanagari}|\p{Script=Thai}/u;

const skipDir = new Set([
  ".git",
  "node_modules",
  "dist",
  ".wrangler",
  ".generated",
  ".brand-preview",
  "playwright-report",
  "test-results",
  "coverage",
]);

const textExt = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".yml",
  ".yaml",
  ".html",
]);

export function exempt(file) {
  const normalized = file.split(path.sep).join("/");
  return normalized === "brand/locale.json";
}

export function scanText(label, text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (nonLatin.test(lines[index])) problems.push(`${label}:${index + 1}`);
  }
  return problems;
}

function walk(dir, problems) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(process.cwd(), full);
    if (skipDir.has(entry) || skipDir.has(rel)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, problems);
      continue;
    }
    if (!textExt.has(path.extname(entry))) continue;
    if (exempt(rel)) continue;
    if (stat.size > 1_000_000) continue;
    problems.push(...scanText(rel, readFileSync(full, "utf8")));
  }
}

function main() {
  const args = process.argv.slice(2);
  const problems = [];

  if (args[0] === "--commit") {
    problems.push(
      ...scanText(args[1] ?? "commit", readFileSync(args[1], "utf8")),
    );
  } else if (args[0] === "--text") {
    problems.push(...scanText("text", args.slice(1).join(" ")));
  } else if (args[0] === "--stdin") {
    problems.push(...scanText("stdin", readFileSync(0, "utf8")));
  } else {
    walk(process.cwd(), problems);
  }

  if (problems.length > 0) {
    console.error("Non-Latin text is only allowed in brand/locale.json:");
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("lint-lang.mjs")) main();
