#!/usr/bin/env node

import { readFileSync } from "node:fs";

function load(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function placeholders(value) {
  const names = new Set();
  for (const match of String(value).matchAll(/\{(\w+)(?:\s*,|\})/g))
    names.add(match[1]);
  return [...names].sort().join(",");
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

export function compare(leftName, left, rightName, right, problems) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  for (const key of leftKeys) {
    if (!(key in right)) problems.push(`${rightName} is missing ${key}`);
  }
  for (const key of rightKeys) {
    if (!(key in left)) problems.push(`${rightName} has extra ${key}`);
  }
  for (const key of leftKeys) {
    if (!(key in right)) continue;
    if (!bracesBalanced(left[key]) || !bracesBalanced(right[key]))
      problems.push(`${key} has unbalanced braces`);
    const a = placeholders(left[key]);
    const b = placeholders(right[key]);
    if (a !== b)
      problems.push(
        `${key} placeholders differ (${leftName}: ${a || "-"} / ${rightName}: ${b || "-"})`,
      );
  }
}

export function catalogProblems(en, ko, brandCopies) {
  const problems = [];
  compare("en", en, "ko", ko, problems);
  for (const [locale, copy] of Object.entries(brandCopies)) {
    for (const [key, value] of Object.entries(copy)) {
      if (!(key in en))
        problems.push(
          `brand/copy/${locale}.json key ${key} is not in locales/en.json`,
        );
      else if (placeholders(value) !== placeholders(en[key]))
        problems.push(
          `brand/copy/${locale}.json ${key} placeholders differ from English`,
        );
      if (!bracesBalanced(value))
        problems.push(`brand/copy/${locale}.json ${key} has unbalanced braces`);
    }
  }
  return problems;
}

function main() {
  const en = load("locales/en.json");
  const ko = load("locales/ko.json");
  const problems = catalogProblems(en, ko, {
    en: load("brand/copy/en.json"),
    ko: load("brand/copy/ko.json"),
  });

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log("i18n catalogs match");
}

if (process.argv[1]?.endsWith("i18n-check.mjs")) main();
