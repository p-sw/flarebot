#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["src", "brand", "worker", "shared"];
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "coverage",
  "src/paraglide",
  ".generated",
]);

export function placeholderNames(template) {
  const names = new Set();
  const plural = /\{(\w+),\s*plural,(?:\s*[a-z]+\s*\{[^{}]*\})+\s*\}/g;
  const withoutPlurals = String(template).replace(plural, (_match, name) => {
    names.add(name);
    return "";
  });
  for (const match of withoutPlurals.matchAll(/\{(\w+)\}/g))
    names.add(match[1]);
  return [...names].sort();
}

function bracesBalanced(value) {
  let depth = 0;
  for (const char of String(value)) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(process.cwd(), full);
    if (SKIP_DIR.has(entry) || SKIP_DIR.has(rel)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
    if (rel.endsWith(".ts") || rel.endsWith(".tsx")) files.push(rel);
  }
}

export function sourceFiles() {
  const files = [];
  for (const root of ROOTS) walk(root, files);
  return files;
}

export function usedKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(
    /\b(?:t|copy)\(\s*["']([A-Za-z0-9_]+)["']/g,
  )) {
    keys.add(match[1]);
  }
  return keys;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function hardcodedUi(rel, source) {
  if (!rel.endsWith(".tsx")) return [];
  const text = stripComments(source);
  const problems = [];
  const elements = /<([A-Za-z][A-Za-z0-9.]*)\b[^<>]*>([^<{][^<]*?)<\/\1>/g;
  for (const match of text.matchAll(elements)) {
    const value = match[2].replace(/\s+/g, " ").trim();
    if (value.includes("{") || value.includes("}")) continue;
    if (/[A-Za-z]{2,}/.test(value))
      problems.push(`${rel} has hardcoded UI text: ${value}`);
  }
  for (const match of text.matchAll(
    /\b(?:placeholder|aria-label|alt|title)=["']([^"']*[A-Za-z]{2,}[^"']*)["']/g,
  )) {
    problems.push(`${rel} has hardcoded UI attribute: ${match[1]}`);
  }
  return problems;
}

export function apiStringLiterals(rel, source) {
  if (!rel.startsWith("worker/")) return [];
  const problems = [];
  const pattern =
    /new ApiError\(\s*[^,]+,\s*["'][^"']+["']\s*,\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    problems.push(`${rel} has a hardcoded API message: ${match[1]}`);
  }
  return problems;
}

export function catalogProblems(file, files) {
  const problems = [];
  if (
    !file ||
    typeof file.lang !== "string" ||
    !/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(file.lang)
  )
    problems.push("brand/locale.json lang must be a BCP 47 language tag");
  if (
    !file?.messages ||
    typeof file.messages !== "object" ||
    Array.isArray(file.messages)
  )
    return [...problems, "brand/locale.json messages must be an object"];

  const keys = Object.keys(file.messages);
  const used = new Set();
  const texts = files.map((rel) => ({
    rel,
    source: readFileSync(rel, "utf8"),
  }));
  for (const { source } of texts) {
    for (const key of usedKeys(source)) used.add(key);
  }
  for (const key of used) {
    if (!(key in file.messages)) problems.push(`missing copy key ${key}`);
  }
  for (const key of keys) {
    const value = file.messages[key];
    if (typeof value !== "string") problems.push(`${key} must be a string`);
    else if (!bracesBalanced(value))
      problems.push(`${key} has unbalanced braces`);
  }
  for (const { rel, source } of texts) {
    problems.push(...hardcodedUi(rel, source));
    problems.push(...apiStringLiterals(rel, source));
  }
  return problems;
}

function main() {
  const file = JSON.parse(readFileSync("brand/locale.json", "utf8"));
  const problems = catalogProblems(file, sourceFiles());
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(
    `copy catalog ok (${Object.keys(file.messages).length} keys, lang ${file.lang})`,
  );
}

if (process.argv[1]?.endsWith("copy-check.mjs")) main();
