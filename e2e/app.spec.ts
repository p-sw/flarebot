import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const email = "owner@example.com";
const password = "flarebot-pass";
const shots = process.env.FLAREBOT_SHOTS === "1";

async function shot(page: Page, path: string) {
  if (!shots) return;
  mkdirSync("docs/images", { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

async function ensureOwner(page: Page) {
  await page.goto("/");
  const heading = page.getByRole("heading", {
    name: /Set up Flarebot|Sign in|Dashboard/,
  });
  await expect(heading.first()).toBeVisible();
  if (
    await page.getByRole("heading", { name: "Set up Flarebot" }).isVisible()
  ) {
    await page.getByLabel("Setup secret").fill("change-me-setup-secret");
    await page.getByLabel("Your name").fill("Ada");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip email" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Dashboard" }).click();
  } else if (await page.getByRole("heading", { name: "Sign in" }).isVisible()) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

async function createMonitor(
  page: Page,
  input: {
    name: string;
    type: string;
    host?: string;
    port?: string;
    url?: string;
  },
) {
  await page.goto("/monitors/new");
  await page.getByLabel("Name").fill(input.name);
  await page.locator("select[name=type]").selectOption(input.type);
  if (input.url) await page.locator("input[name=url]").fill(input.url);
  if (input.host) await page.locator("input[name=host]").fill(input.host);
  if (input.port) await page.locator("input[name=port]").fill(input.port);
  await page.getByRole("button", { name: "Create" }).click();
  if (input.type === "heartbeat") {
    await expect(page.getByText("Push URL")).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: input.name })).toBeVisible({
    timeout: 30_000,
  });
}

test("setup, monitors, and status page", async ({ page }) => {
  const slug = `status-${Date.now().toString(36)}`;
  await ensureOwner(page);
  await createMonitor(page, {
    name: "Example HTTP",
    type: "http",
    url: "https://example.com",
  });
  await expect(page.getByText("No samples in this range yet.")).toHaveCount(0);
  await shot(page, "docs/images/monitor.png");
  await createMonitor(page, {
    name: "TCP DNS",
    type: "tcp",
    host: "1.1.1.1",
    port: "443",
  });
  await createMonitor(page, { name: "DNS example", type: "dns" });
  await createMonitor(page, {
    name: "SSL example",
    type: "ssl",
    host: "example.com",
  });
  await createMonitor(page, { name: "Heartbeat job", type: "heartbeat" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/\d+(\.\d+)?%/).first()).toBeVisible();
  await shot(page, "docs/images/dashboard.png");
  await page.goto("/status-pages");
  await page.getByLabel("Title").fill("Public status");
  await page.getByLabel("Slug").fill(slug);
  await page.locator("select[name=monitorId]").selectOption({ index: 1 });
  await page.getByRole("button", { name: "New status page" }).click();
  await page.goto(`/s/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Public status" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Korean" })).toBeVisible();
  await shot(page, "docs/images/status.png");
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await shot(page, "docs/images/login.png");
});
