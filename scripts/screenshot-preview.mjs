import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

// Local demo database only. This process never reads production D1.
const persist = ".wrangler/screenshots";

execFileSync("node", ["scripts/ensure-dev-vars.mjs"], { stdio: "inherit" });

// vite preview reads dist/flarebot/.dev.vars, which is copied from the
// project file. The flag has to be on the project file before that copy.
// It is removed on exit so `pnpm dev` does not keep the route.
const rootVars = ".dev.vars";
const distVars = "dist/flarebot/.dev.vars";
const flagLine = "FLAREBOT_SCREENSHOTS=1";
const stamp = ".wrangler/screenshot-flag";

function withoutFlag(text) {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("FLAREBOT_SCREENSHOTS="))
    .join("\n")
    .replace(/\n*$/, "\n");
}

const hadFlag = readFileSync(rootVars, "utf8").includes(
  "FLAREBOT_SCREENSHOTS=",
);
if (!hadFlag) {
  const current = readFileSync(rootVars, "utf8");
  appendFileSync(
    rootVars,
    `${current.endsWith("\n") ? "" : "\n"}${flagLine}\n`,
  );
  mkdirSync(".wrangler", { recursive: true });
  writeFileSync(stamp, "1");
}

let restored = false;
function restoreFlag() {
  if (restored || hadFlag) return;
  restored = true;
  writeFileSync(rootVars, withoutFlag(readFileSync(rootVars, "utf8")));
  if (existsSync(distVars)) {
    writeFileSync(distVars, withoutFlag(readFileSync(distVars, "utf8")));
  }
  rmSync(stamp, { force: true });
}

execFileSync("node", ["scripts/preview-dev-vars.mjs"], { stdio: "inherit" });

if (!existsSync("dist/flarebot")) {
  restoreFlag();
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

function shutdown(code) {
  restoreFlag();
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  process.exit(code);
}

process.on("exit", restoreFlag);
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

child.on("exit", (code, signal) => {
  restoreFlag();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
