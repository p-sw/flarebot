#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const name = process.argv[2];
if (!name || name.includes("/") || name.includes("..")) {
  console.error("Usage: pnpm eject <component>");
  console.error("Example: pnpm eject button");
  process.exit(1);
}

const source = path.join("src/ui", `${name}.tsx`);
const target = path.join("brand/ui", `${name}.tsx`);
if (!existsSync(source)) {
  console.error(`No upstream component at ${source}`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(
    `${target} already exists. Edit that file; do not eject twice.`,
  );
  process.exit(1);
}
mkdirSync("brand/ui", { recursive: true });
const header = `// Ejected from ${source}. This copy is yours. Upstream updates to src/ui/${name}.tsx will not overwrite it.\n`;
writeFileSync(target, header + readFileSync(source, "utf8"));
copyFileSync(source, `${target}.upstream`);
console.log(`Ejected ${source} -> ${target}`);
console.log(
  `Imports of @/ui/${name} now resolve to brand/ui. Run pnpm typecheck.`,
);
