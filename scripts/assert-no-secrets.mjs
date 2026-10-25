import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const EXAMPLE_SECRET_VALUES = [
  "change-me-setup-secret",
  "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
];

export const CLIENT_SECRET_NAMES = ["SETUP_SECRET", "ENCRYPTION_KEY"];

export function valuesFromDevVars(text) {
  const values = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length >= 12) values.push(value);
  }
  return values;
}

function walk(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

export function stripDevVarFiles(root) {
  const removed = [];
  for (const file of walk(root)) {
    const base = path.basename(file);
    if (base === ".dev.vars" || base.startsWith(".dev.vars.")) {
      rmSync(file);
      removed.push(file);
    }
  }
  return removed;
}

export function findSecretLeaks(root, values) {
  const problems = [];
  const unique = [...new Set(values.filter((value) => value.length >= 12))];
  for (const file of walk(root)) {
    const relative = path.relative(root, file);
    const base = path.basename(file);
    if (base === ".dev.vars" || base.startsWith(".dev.vars.")) {
      problems.push(`${relative}: dev vars file in the build output`);
    }
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const value of unique) {
      if (text.includes(value))
        problems.push(`${relative}: contains a secret value`);
    }
    const inClient =
      relative === "client" ||
      relative.startsWith(`client${path.sep}`) ||
      relative.startsWith("client/");
    if (inClient) {
      for (const name of CLIENT_SECRET_NAMES) {
        if (text.includes(name)) {
          problems.push(`${relative}: client asset contains ${name}`);
        }
      }
    }
  }
  return problems.sort();
}

function collectValues() {
  const values = [...EXAMPLE_SECRET_VALUES];
  for (const file of [".dev.vars", ".dev.vars.example"]) {
    if (!existsSync(file)) continue;
    values.push(...valuesFromDevVars(readFileSync(file, "utf8")));
  }
  return values;
}

function main() {
  const root = process.argv[2] ?? "dist";
  stripDevVarFiles(root);
  const problems = findSecretLeaks(root, collectValues());
  if (problems.length > 0) {
    console.error("Production build output contains secrets:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("assert-no-secrets.mjs")) main();
