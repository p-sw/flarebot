import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const locales = ["en", "ko"];
mkdirSync(".generated/locales", { recursive: true });

for (const locale of locales) {
  const base = JSON.parse(readFileSync(`locales/${locale}.json`, "utf8"));
  let override = {};
  try {
    override = JSON.parse(readFileSync(`brand/copy/${locale}.json`, "utf8"));
  } catch {
    override = {};
  }
  writeFileSync(
    `.generated/locales/${locale}.json`,
    `${JSON.stringify({ ...base, ...override }, null, 2)}\n`,
  );
}

const bin = "node_modules/@inlang/paraglide-js/bin/run.js";
execFileSync(
  process.execPath,
  [
    bin,
    "compile",
    "--project",
    "./project.inlang",
    "--outdir",
    "./src/paraglide",
    "--silent",
  ],
  { stdio: "inherit" },
);
