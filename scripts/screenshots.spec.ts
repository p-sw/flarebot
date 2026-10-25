import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

const origin = "http://127.0.0.1:4174";
const outDir = path.resolve("docs/images");
const jsonHeaders = {
  origin,
  "content-type": "application/json",
};
const hourMs = 3_600_000;
const dayMs = 86_400_000;

type MonitorKind = "up" | "down" | "paused";

type DemoMonitor = {
  id: string;
  name: string;
  kind: MonitorKind;
};

function setupSecret(): string {
  const text = readFileSync(".dev.vars", "utf8");
  const line = text.split("\n").find((row) => row.startsWith("SETUP_SECRET="));
  return line?.slice("SETUP_SECRET=".length).trim() || "change-me-setup-secret";
}

function utcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

async function createMonitor(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ id: string; pushUrl?: string }> {
  const response = await request.post("/api/monitors", {
    headers: jsonHeaders,
    data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string; pushUrl?: string };
}

async function monitorStatus(
  request: APIRequestContext,
  id: string,
): Promise<string> {
  const response = await request.get(`/api/monitors/${id}`, {
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { status: string }).status;
}

function seedHistory(monitors: DemoMonitor[]): void {
  const now = Date.now();
  const hour = Math.floor(now / hourMs) * hourMs;
  const today = utcDayStart(now);
  const lines: string[] = [];
  for (const monitor of monitors) {
    if (!/^[0-9a-f-]{36}$/i.test(monitor.id)) {
      throw new Error(
        `Refusing to seed an unexpected monitor id: ${monitor.id}`,
      );
    }
    for (let ago = 0; ago < 24; ago += 1) {
      const start = hour - ago * hourMs;
      const failing = monitor.kind === "down" && ago < 8;
      const ok = failing ? 2 : 18;
      const fail = failing ? 12 : ago === 5 && monitor.kind === "up" ? 1 : 0;
      const samples = failing ? "[480,520,610]" : "[72,84,91,68]";
      const sum = (ok + fail) * (failing ? 520 : 80);
      lines.push(
        `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json) VALUES ('${monitor.id}', ${start}, ${ok}, ${fail}, ${sum}, ${failing ? 900 : 140}, '${samples}') ON CONFLICT(monitor_id, hour_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max, samples_json = excluded.samples_json;`,
      );
    }
    for (let ago = 1; ago <= 6; ago += 1) {
      const start = today - ago * dayMs;
      const ok = monitor.kind === "down" ? 240 : 500;
      const fail = monitor.kind === "down" ? 30 : 2;
      const sum = (ok + fail) * (monitor.kind === "down" ? 260 : 85);
      lines.push(
        `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max) VALUES ('${monitor.id}', ${start}, ${ok}, ${fail}, ${sum}, ${monitor.kind === "down" ? 700 : 160}) ON CONFLICT(monitor_id, day_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max;`,
      );
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), "flarebot-shots-"));
  const file = path.join(dir, "seed.sql");
  writeFileSync(file, lines.join("\n"));
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        ".wrangler/screenshots",
        "--file",
        file,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type SharpModule = (input: Buffer) => {
  webp: (options: { quality: number }) => {
    toFile: (file: string) => Promise<void>;
  };
};

function loadSharp(): SharpModule {
  const root = path.resolve("node_modules/.pnpm");
  const entry = readdirSync(root).find((name) => name.startsWith("sharp@"));
  if (!entry) throw new Error("sharp is not installed");
  const require = createRequire(import.meta.url);
  return require(path.join(root, entry, "node_modules/sharp")) as SharpModule;
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function saveShot(page: Page, name: string): Promise<void> {
  const sharp = loadSharp();
  const png = await page.screenshot({ fullPage: true, animations: "disabled" });
  await sharp(png).webp({ quality: 80 }).toFile(path.join(outDir, name));
}

test("captures the four README screenshots from local demo data", async ({
  browser,
  request,
}) => {
  const setup = await request.post("/api/setup", {
    headers: jsonHeaders,
    data: {
      setupSecret: setupSecret(),
      name: "Mina Chen",
      email: "mina@harbor.example",
      password: "harbor-demo-pass",
    },
  });
  expect(setup.status(), await setup.text()).toBe(201);

  const login = await request.post("/api/auth/login", {
    headers: jsonHeaders,
    data: { email: "mina@harbor.example", password: "harbor-demo-pass" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const cookie = /flarebot_session=([^;]+)/.exec(
    login.headers()["set-cookie"] ?? "",
  )?.[1];
  expect(cookie).toBeTruthy();

  const common = {
    intervalSeconds: 300,
    timeoutSeconds: 15,
    recoveryThreshold: 1,
    channelIds: [],
  };
  const website = await createMonitor(request, {
    ...common,
    name: "Website",
    type: "http",
    retries: 2,
    config: { url: "https://example.com", expectedStatuses: [200] },
  });
  const billing = await createMonitor(request, {
    ...common,
    name: "Billing API",
    type: "http",
    retries: 1,
    config: {
      url: "https://example.com/billing",
      expectedStatuses: [200],
    },
  });
  const proxy = await createMonitor(request, {
    ...common,
    name: "Edge proxy",
    type: "tcp",
    retries: 2,
    config: { host: "1.1.1.1", port: 443 },
  });
  const dns = await createMonitor(request, {
    ...common,
    name: "Public DNS",
    type: "dns",
    retries: 2,
    config: {
      name: "one.one.one.one",
      type: "A",
      expected: ["1.1.1.1"],
    },
  });
  const hook = await createMonitor(request, {
    ...common,
    name: "Deploy hook",
    type: "heartbeat",
    retries: 1,
    config: { graceSeconds: 300 },
  });
  expect(hook.pushUrl).toBeTruthy();
  const ping = await request.get(hook.pushUrl ?? "");
  expect(ping.ok(), await ping.text()).toBeTruthy();
  const nightly = await createMonitor(request, {
    ...common,
    name: "Nightly job",
    type: "heartbeat",
    retries: 1,
    paused: true,
    config: { graceSeconds: 120 },
  });

  await expect
    .poll(() => monitorStatus(request, hook.id), { timeout: 15_000 })
    .toBe("up");
  expect(await monitorStatus(request, website.id)).toBe("up");
  expect(await monitorStatus(request, billing.id)).toBe("down");
  expect(await monitorStatus(request, proxy.id)).toBe("up");
  expect(await monitorStatus(request, dns.id)).toBe("up");
  expect(await monitorStatus(request, nightly.id)).toBe("paused");

  const page = await request.post("/api/status-pages", {
    headers: jsonHeaders,
    data: {
      slug: "harbor",
      published: true,
      serveAtRoot: true,
      title: "Harbor",
      description: "Public site, APIs, and the platform underneath.",
      banner: "Billing API is returning errors. Everything else is up.",
      footer: "Harbor posts incident notes on this page.",
      accent: "#3d6f78",
      displayRange: "7d",
      items: [
        {
          monitorId: website.id,
          position: 0,
          groupName: "Edge",
          displayName: "Website",
        },
        {
          monitorId: billing.id,
          position: 1,
          groupName: "Edge",
          displayName: "Billing API",
        },
        {
          monitorId: proxy.id,
          position: 2,
          groupName: "Platform",
          displayName: "Edge proxy",
        },
        {
          monitorId: dns.id,
          position: 3,
          groupName: "Platform",
          displayName: "Public DNS",
        },
        {
          monitorId: hook.id,
          position: 4,
          groupName: "Platform",
          displayName: "Deploy hook",
        },
        {
          monitorId: nightly.id,
          position: 5,
          groupName: "Platform",
          displayName: "Nightly job",
        },
      ],
    },
  });
  expect(page.status(), await page.text()).toBe(201);

  seedHistory([
    { id: website.id, name: "Website", kind: "up" },
    { id: billing.id, name: "Billing API", kind: "down" },
    { id: proxy.id, name: "Edge proxy", kind: "up" },
    { id: dns.id, name: "Public DNS", kind: "up" },
    { id: hook.id, name: "Deploy hook", kind: "up" },
    { id: nightly.id, name: "Nightly job", kind: "paused" },
  ]);

  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  await desktop.addCookies([
    {
      name: "flarebot_session",
      value: cookie ?? "",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const desk = await desktop.newPage();
  await desk.goto("/");
  await expect(desk.getByRole("heading", { name: "Harbor" })).toBeVisible();
  await expect(desk.getByText("7 days").first()).toBeVisible();
  await expect(
    desk.getByRole("heading", { name: "Edge", exact: true }),
  ).toBeVisible();
  await expect(
    desk.getByRole("heading", { name: "Platform", exact: true }),
  ).toBeVisible();
  await expect(desk.getByText("Paused").first()).toBeVisible();
  await settle(desk);
  await saveShot(desk, "status.webp");

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await phone.newPage();
  await mobile.goto("/");
  await expect(mobile.getByRole("heading", { name: "Harbor" })).toBeVisible();
  await expect(mobile.getByText("Billing API").first()).toBeVisible();
  await settle(mobile);
  await saveShot(mobile, "status-mobile.webp");

  await desk.goto("/console");
  await expect(desk.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(desk.getByText("6 monitors")).toBeVisible();
  await expect(desk.getByText("Website")).toBeVisible();
  await expect(desk.getByText("Nightly job")).toBeVisible();
  await settle(desk);
  await saveShot(desk, "dashboard.webp");

  await desk.goto(`/console/monitors/${website.id}`);
  await expect(desk.getByRole("heading", { name: "Website" })).toBeVisible();
  await expect(desk.getByText("24 hours", { exact: true })).toBeVisible();
  await expect(desk.getByText("90 days", { exact: true })).toBeVisible();
  await settle(desk);
  await saveShot(desk, "monitor.webp");

  await desktop.close();
  await phone.close();
});
