import { copyFileSync, existsSync, mkdirSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
}
mkdirSync("dist/flarebot", { recursive: true });
copyFileSync(".dev.vars", "dist/flarebot/.dev.vars");
