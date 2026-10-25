import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

// Local demo database only. This process never reads production D1.
const persist = ".wrangler/screenshots";

execFileSync("node", ["scripts/ensure-dev-vars.mjs"], { stdio: "inherit" });
execFileSync("node", ["scripts/preview-dev-vars.mjs"], { stdio: "inherit" });
if (!existsSync("dist/flarebot")) {
  console.error("Run pnpm build before starting the screenshot preview.");
  process.exit(1);
}

rmSync(persist, { recursive: true, force: true });
execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    persist,
  ],
  { stdio: "inherit" },
);

const child = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      FLAREBOT_E2E: "1",
      FLAREBOT_PERSIST: persist,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
