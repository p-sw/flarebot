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

type Bucket = { ok: number; fail: number; ms: number };

// Fixed shapes, not one shared ratio. A few hours are partial or a short
// outage so the bars are not a solid stripe. Heartbeats keep ms at 0.
function hourBucket(name: string, ago: number): Bucket {
  if (name === "Website") {
    if (ago === 16) return { ok: 9, fail: 7, ms: 860 };
    if (ago === 5) return { ok: 104, fail: 8, ms: 230 };
    return { ok: 120, fail: ago === 11 ? 1 : 0, ms: 44 + (ago % 8) * 6 };
  }
  if (name === "Billing API") {
    if (ago < 4) return { ok: 2, fail: 22, ms: 480 + ago * 40 };
    if (ago < 7) return { ok: 14, fail: 9, ms: 280 };
    if (ago === 19) return { ok: 36, fail: 4, ms: 160 };
    return { ok: 40, fail: 0, ms: 88 + (ago % 5) * 7 };
  }
  if (name === "Edge proxy") {
    if (ago === 8) return { ok: 76, fail: 4, ms: 36 };
    return { ok: 80, fail: 0, ms: 8 + (ago % 6) * 3 };
  }
  if (name === "Public DNS") {
    return { ok: 50, fail: 0, ms: 17 + (ago % 5) * 4 };
  }
  if (name === "Deploy hook") {
    if (ago === 10) return { ok: 4, fail: 3, ms: 0 };
    if (ago === 21) return { ok: 20, fail: 2, ms: 0 };
    return { ok: 24, fail: 0, ms: 0 };
  }
  if (ago === 6) return { ok: 27, fail: 3, ms: 0 };
  return { ok: 30, fail: 0, ms: 0 };
}

function dayBucket(name: string, ago: number): Bucket {
  if (name === "Billing API") {
    return { ok: 520, fail: ago === 4 ? 80 : 18, ms: 140 };
  }
  if (name === "Website") return { ok: 900, fail: ago === 5 ? 6 : 1, ms: 58 };
  if (name === "Edge proxy")
    return { ok: 700, fail: ago === 6 ? 4 : 0, ms: 14 };
  if (name === "Public DNS") return { ok: 640, fail: 0, ms: 24 };
  return { ok: 280, fail: ago === 9 ? 2 : 0, ms: 0 };
}

function sampleJson(ms: number, fail: number): string {
  if (ms <= 0) return "[]";
  const slow = fail > 0 ? ms + 420 : ms + 11;
  return `[${Math.max(1, ms - 9)},${ms},${ms + 14},${slow}]`;
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
      const bucket = hourBucket(monitor.name, ago);
      const total = bucket.ok + bucket.fail;
      const sum = total * bucket.ms;
      const max = bucket.ms <= 0 ? 0 : bucket.ms + (bucket.fail > 0 ? 700 : 28);
      lines.push(
        `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json) VALUES ('${monitor.id}', ${hour - ago * hourMs}, ${bucket.ok}, ${bucket.fail}, ${sum}, ${max}, '${sampleJson(bucket.ms, bucket.fail)}') ON CONFLICT(monitor_id, hour_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max, samples_json = excluded.samples_json;`,
      );
    }
    for (let ago = 3; ago <= 14; ago += 1) {
      const bucket = dayBucket(monitor.name, ago);
      const sum = (bucket.ok + bucket.fail) * bucket.ms;
      lines.push(
        `INSERT INTO uptime_daily (monitor_id, day_start, ok_count, fail_count, latency_sum, latency_max) VALUES ('${monitor.id}', ${today - ago * dayMs}, ${bucket.ok}, ${bucket.fail}, ${sum}, ${bucket.ms + 40}) ON CONFLICT(monitor_id, day_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max;`,
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
      displayRange: "24h",
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
  await expect(desk.getByText("24 hours").first()).toBeVisible();
  const status = (await (
    await request.get("/api/public/status/harbor")
  ).json()) as {
    displayRange: string;
    bucket: string;
    groups: {
      items: {
        name: string;
        uptime: number | null;
        responseMs: number | null;
        bars: { uptime: number | null }[];
      }[];
    }[];
  };
  expect(status.displayRange).toBe("24h");
  expect(status.bucket).toBe("slot");
  const items = status.groups.flatMap((group) => group.items);
  const byName = new Map(items.map((item) => [item.name, item]));
  const websiteBars = byName.get("Website")?.bars ?? [];
  expect(
    websiteBars.some((bar) => bar.uptime != null && bar.uptime < 90),
  ).toBeTruthy();
  expect(
    websiteBars.some(
      (bar) => bar.uptime != null && bar.uptime >= 90 && bar.uptime < 99,
    ),
  ).toBeTruthy();
  const uptimes = items.map((item) => item.uptime);
  expect(new Set(uptimes).size).toBeGreaterThanOrEqual(5);
  expect(byName.get("Website")?.responseMs).not.toBe(
    byName.get("Edge proxy")?.responseMs,
  );
  expect(byName.get("Public DNS")?.responseMs).not.toBe(
    byName.get("Website")?.responseMs,
  );
  expect(byName.get("Deploy hook")?.responseMs).toBe(0);
  const hookCard = desk.getByRole("article").filter({ hasText: "Deploy hook" });
  await expect(hookCard.getByText("0 ms")).toHaveCount(0);
  await expect(hookCard.getByText("—")).toBeVisible();
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
  await expect(desk.getByText("0 ms")).toHaveCount(0);
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
