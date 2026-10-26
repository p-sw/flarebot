import { execFileSync } from "node:child_process";
import {
  existsSync,
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
const slotMs = 15 * 60 * 1000;
const slotBars = 96;

type DemoMonitor = {
  id: string;
  name: string;
};

type Bucket = { ok: number; fail: number; ms: number };

type SparkPoint = { t: number; ok: boolean; ms: number };

function setupSecret(): string {
  const text = readFileSync(".dev.vars", "utf8");
  const line = text.split("\n").find((row) => row.startsWith("SETUP_SECRET="));
  return line?.slice("SETUP_SECRET=".length).trim() || "change-me-setup-secret";
}

function utcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function assertUuid(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error(`Refusing to seed an unexpected id: ${id}`);
  }
}

async function postJson(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
  status = 201,
): Promise<Record<string, unknown>> {
  const response = await request.post(url, { headers: jsonHeaders, data });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

async function createMonitor(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ id: string; pushUrl?: string }> {
  return (await postJson(request, "/api/monitors", body)) as {
    id: string;
    pushUrl?: string;
  };
}

// Fifteen-minute bars. A few slots are partial or down so the row is not one
// solid stripe. Heartbeats keep ms at 0, which the status page renders as an
// em dash rather than "0 ms".
function slotBucket(name: string, ago: number): Bucket {
  if (name === "Website") {
    if (ago === 64) return { ok: 1, fail: 6, ms: 860 };
    if (ago === 20 || ago === 21) return { ok: 10, fail: 1, ms: 240 };
    if (ago === 44) return { ok: 40, fail: 1, ms: 70 };
    return { ok: 12, fail: 0, ms: 48 + (ago % 5) * 4 };
  }
  if (name === "Billing API") {
    if (ago < 16) return { ok: 1, fail: 8, ms: 520 };
    if (ago < 28) return { ok: 19, fail: 1, ms: 280 };
    if (ago === 76) return { ok: 9, fail: 1, ms: 160 };
    return { ok: 10, fail: 0, ms: 96 + (ago % 4) * 6 };
  }
  if (name === "Edge proxy") {
    if (ago === 32) return { ok: 18, fail: 1, ms: 36 };
    return { ok: 20, fail: 0, ms: 11 + (ago % 4) };
  }
  if (name === "Public DNS") {
    return { ok: 16, fail: 0, ms: 18 + (ago % 3) * 2 };
  }
  if (name === "Deploy hook") {
    if (ago === 40) return { ok: 3, fail: 1, ms: 0 };
    return { ok: 6, fail: 0, ms: 0 };
  }
  if (ago === 24) return { ok: 4, fail: 2, ms: 0 };
  return { ok: 8, fail: 0, ms: 0 };
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

function sparkPoints(name: string, now: number): SparkPoint[] {
  const points: SparkPoint[] = [];
  const count = 48;
  for (let index = 0; index < count; index += 1) {
    const t = now - (count - 1 - index) * 5 * 60_000;
    if (name === "Website") {
      const wave = Math.round(14 * Math.sin(index / 3));
      points.push({ t, ok: true, ms: 52 + wave + (index % 4) * 3 });
      continue;
    }
    if (name === "Billing API") {
      const failing = index >= count - 12;
      points.push({
        t,
        ok: !failing,
        ms: failing ? 420 + (index % 6) * 45 : 88 + (index % 5) * 8,
      });
      continue;
    }
    if (name === "Edge proxy") {
      points.push({ t, ok: true, ms: 9 + (index % 6) * 2 });
      continue;
    }
    if (name === "Public DNS") {
      points.push({ t, ok: true, ms: 16 + (index % 5) * 3 });
      continue;
    }
    points.push({ t, ok: true, ms: 0 });
  }
  return points;
}

function demoStatus(name: string): "up" | "down" | "paused" {
  if (name === "Billing API") return "down";
  if (name === "Nightly job") return "paused";
  return "up";
}

function seedHistory(monitors: DemoMonitor[], outageMonitorId: string): void {
  const now = Date.now();
  const currentSlot = Math.floor(now / slotMs) * slotMs;
  const today = utcDayStart(now);
  const lines: string[] = [];
  assertUuid(outageMonitorId);
  const outageId = crypto.randomUUID();
  assertUuid(outageId);
  lines.push(
    `INSERT INTO outages (id, monitor_id, started_at, ended_at, cause, acknowledged_by, acknowledged_at) VALUES ('${outageId}', '${outageMonitorId}', ${now - 3 * hourMs}, NULL, 'HTTP 502', NULL, NULL);`,
  );
  for (const monitor of monitors) {
    assertUuid(monitor.id);
    const hours = new Map<number, Bucket & { max: number }>();
    for (let ago = 0; ago < slotBars; ago += 1) {
      const bucket = slotBucket(monitor.name, ago);
      const start = currentSlot - ago * slotMs;
      const total = bucket.ok + bucket.fail;
      const max = bucket.ms <= 0 ? 0 : bucket.ms + (bucket.fail > 0 ? 400 : 20);
      lines.push(
        `INSERT INTO uptime_slots (monitor_id, slot_start, ok_count, fail_count, latency_sum, latency_max, maint_count) VALUES ('${monitor.id}', ${start}, ${bucket.ok}, ${bucket.fail}, ${total * bucket.ms}, ${max}, 0) ON CONFLICT(monitor_id, slot_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max, maint_count = excluded.maint_count;`,
      );
      const hourStart = Math.floor(start / hourMs) * hourMs;
      const hour = hours.get(hourStart) ?? { ok: 0, fail: 0, ms: 0, max: 0 };
      hour.ok += bucket.ok;
      hour.fail += bucket.fail;
      hour.ms += total * bucket.ms;
      hour.max = Math.max(hour.max, max);
      hours.set(hourStart, hour);
    }
    for (const [hourStart, hour] of hours) {
      const avg =
        hour.ok + hour.fail === 0
          ? 0
          : Math.round(hour.ms / (hour.ok + hour.fail));
      lines.push(
        `INSERT INTO uptime_hourly (monitor_id, hour_start, ok_count, fail_count, latency_sum, latency_max, samples_json) VALUES ('${monitor.id}', ${hourStart}, ${hour.ok}, ${hour.fail}, ${hour.ms}, ${hour.max}, '${sampleJson(avg, hour.fail)}') ON CONFLICT(monitor_id, hour_start) DO UPDATE SET ok_count = excluded.ok_count, fail_count = excluded.fail_count, latency_sum = excluded.latency_sum, latency_max = excluded.latency_max, samples_json = excluded.samples_json;`,
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

async function savePng(png: Buffer, name: string): Promise<void> {
  const sharp = loadSharp();
  await sharp(png).webp({ quality: 80 }).toFile(path.join(outDir, name));
}

async function saveShot(
  page: Page,
  name: string,
  fullPage = true,
): Promise<void> {
  const png = await page.screenshot({ fullPage, animations: "disabled" });
  await savePng(png, name);
}

// fullPage stitches a scrolled capture and repaints sticky chrome in the
// wrong place. Grow the viewport to the document instead, then shoot once
// from the top so the sidebar and header stay where the layout put them.
async function fitConsoleViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  let height = 900;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = await page.evaluate(() =>
      Math.ceil(
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        ),
      ),
    );
    if (Math.abs(next - height) <= 1) break;
    height = Math.max(900, Math.min(next, 8_000));
    await page.setViewportSize({ width: 1280, height });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

async function assertConsoleFrame(page: Page): Promise<void> {
  const frame = await page.evaluate(() => {
    const sidebar = document.querySelector("#admin-sidebar");
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    if (
      !(sidebar instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(main instanceof HTMLElement)
    ) {
      return null;
    }
    const side = sidebar.getBoundingClientRect();
    const bar = header.getBoundingClientRect();
    const content = main.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      viewport: window.innerHeight,
      sidebarTop: side.top,
      sidebarHeight: side.height,
      headerTop: bar.top,
      headerBottom: bar.bottom,
      mainTop: content.top,
    };
  });
  expect(frame).not.toBeNull();
  if (!frame) return;
  expect(frame.scrollY).toBe(0);
  expect(frame.sidebarTop).toBeGreaterThanOrEqual(0);
  expect(frame.sidebarTop).toBeLessThan(2);
  expect(Math.abs(frame.sidebarHeight - frame.viewport)).toBeLessThan(2);
  expect(frame.headerTop).toBeGreaterThanOrEqual(0);
  expect(frame.headerTop).toBeLessThan(2);
  expect(frame.mainTop).toBeGreaterThanOrEqual(frame.headerBottom - 1);
}

async function saveConsoleShot(page: Page, name: string): Promise<void> {
  await fitConsoleViewport(page);
  await assertConsoleFrame(page);
  await settle(page);
  const png = await page.screenshot({
    fullPage: false,
    animations: "disabled",
  });
  await savePng(png, name);
}

function stripScreenshotFlag(file: string): void {
  if (!existsSync(file)) return;
  const next = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("FLAREBOT_SCREENSHOTS="))
    .join("\n")
    .replace(/\n*$/, "\n");
  writeFileSync(file, next);
}

test.afterAll(() => {
  if (!existsSync(".wrangler/screenshot-flag")) return;
  stripScreenshotFlag(".dev.vars");
  stripScreenshotFlag("dist/flarebot/.dev.vars");
  rmSync(".wrangler/screenshot-flag", { force: true });
});

test("captures the dashboard and status page screenshots from local demo data", async ({
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
    paused: true,
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
    config: { host: "example.com", port: 443 },
  });
  const dns = await createMonitor(request, {
    ...common,
    name: "Public DNS",
    type: "dns",
    retries: 2,
    config: {
      name: "example.com",
      type: "A",
      expected: ["203.0.113.10"],
    },
  });
  const hook = await createMonitor(request, {
    ...common,
    name: "Deploy hook",
    type: "heartbeat",
    retries: 1,
    config: { graceSeconds: 300 },
  });
  const nightly = await createMonitor(request, {
    ...common,
    name: "Nightly job",
    type: "heartbeat",
    retries: 1,
    config: { graceSeconds: 120 },
  });
  const monitors: DemoMonitor[] = [
    { id: website.id, name: "Website" },
    { id: billing.id, name: "Billing API" },
    { id: proxy.id, name: "Edge proxy" },
    { id: dns.id, name: "Public DNS" },
    { id: hook.id, name: "Deploy hook" },
    { id: nightly.id, name: "Nightly job" },
  ];

  const page = await postJson(request, "/api/status-pages", {
    slug: "harbor",
    published: true,
    serveAtRoot: true,
    title: "Harbor",
    description: "Public site, APIs, and the platform underneath.",
    banner:
      "Billing API is returning errors. Edge proxy is in a maintenance window.",
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
  });
  const pageId = String(page.id);

  const mail = await request.put("/api/settings/mail", {
    headers: jsonHeaders,
    data: {
      driver: "smtp",
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "bot",
      password: "secret",
      fromName: "Harbor",
      fromAddress: "bot@harbor.example",
    },
  });
  expect(mail.status(), await mail.text()).toBe(200);
  const flags = await request.put(`/api/status-pages/${pageId}/subscriptions`, {
    headers: jsonHeaders,
    data: { email: true, webhook: true, rss: true },
  });
  expect(flags.ok(), await flags.text()).toBeTruthy();

  const now = Date.now();
  await postJson(request, "/api/incidents", {
    title: "Billing API errors",
    notify: false,
    channelIds: [],
    pageIds: [pageId],
    monitors: [{ monitorId: billing.id, impact: "major_outage" }],
    update: {
      status: "investigating",
      body: "Checkout requests are failing. The site and the other APIs are up.",
      postedAt: now,
    },
  });
  await postJson(request, "/api/maintenance", {
    title: "Edge proxy certificate rotation",
    description:
      "Short window while the proxy certificate is replaced. Alerts stay quiet.",
    timezone: "UTC",
    startAt: now - 30 * 60_000,
    endAt: now + 2 * hourMs,
    recurrence: "once",
    weekdays: [],
    notify: false,
    channelIds: [],
    pageIds: [pageId],
    monitorIds: [proxy.id],
  });
  await postJson(request, "/api/maintenance", {
    title: "Public DNS resolver reload",
    description: "Scheduled reload of the public resolvers.",
    timezone: "UTC",
    startAt: now + 26 * hourMs,
    endAt: now + 28 * hourMs,
    recurrence: "once",
    weekdays: [],
    notify: false,
    channelIds: [],
    pageIds: [pageId],
    monitorIds: [dns.id],
  });

  seedHistory(monitors, billing.id);
  const seededAt = Date.now();
  const history = await postJson(
    request,
    "/api/dev/screenshot-history",
    {
      monitors: monitors.map((monitor) => {
        const points = sparkPoints(monitor.name, seededAt);
        const status = demoStatus(monitor.name);
        const last = points.at(-1);
        return {
          id: monitor.id,
          status,
          lastResponseMs:
            status === "paused" || monitor.name === "Deploy hook"
              ? null
              : (last?.ms ?? null),
          lastError: status === "down" ? "HTTP 502" : null,
          points,
        };
      }),
    },
    200,
  );
  expect(history.ok).toBe(true);

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
  await expect(desk.getByText("Billing API errors")).toBeVisible();
  await expect(desk.getByText("Investigating").first()).toBeVisible();
  await expect(desk.getByText("Edge proxy certificate rotation")).toBeVisible();
  await expect(desk.getByText("In progress").first()).toBeVisible();
  await expect(desk.getByText("Public DNS resolver reload")).toBeVisible();
  await expect(desk.getByText("Upcoming").first()).toBeVisible();
  await expect(
    desk.getByRole("button", { name: "Subscribe to updates" }),
  ).toBeVisible();
  await expect(desk.getByRole("link", { name: "RSS feed" })).toBeVisible();
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

  await desk.goto("/console");
  await expect(desk.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(desk.getByText("6 monitors")).toBeVisible();
  await expect(desk.getByText("Website")).toBeVisible();
  await expect(desk.getByText("Nightly job")).toBeVisible();
  await expect(desk.getByText("0 ms")).toHaveCount(0);
  await desk
    .getByRole("button", { name: "Show recent response time for Website" })
    .click();
  await expect(
    desk.getByText("Recent checks in this summary: 48"),
  ).toBeVisible();
  await saveConsoleShot(desk, "dashboard.webp");

  await desktop.close();
});
