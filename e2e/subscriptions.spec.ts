// SPDX-License-Identifier: MIT

import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createHeartbeat, origin, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";

test("subscribers are configured on the status page and offered to visitors", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const stamp = Date.now().toString(36);
  const monitorName = `Subscribe beat ${stamp}`;
  const title = `Subscribe page ${stamp}`;
  const slug = `sub-${stamp}`;
  const monitorId = await createHeartbeat(page, monitorName);
  const created = await page.request.post("/api/status-pages", {
    headers: { origin, "content-type": "application/json" },
    data: {
      slug,
      published: true,
      title,
      description: "Public services",
      items: [
        {
          monitorId,
          position: 0,
          groupName: "Core",
          displayName: monitorName,
        },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const pageId = ((await created.json()) as { id: string }).id;

  await page.request.put("/api/settings/mail", {
    headers: { origin, "content-type": "application/json" },
    data: {
      driver: "smtp",
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "bot",
      password: "secret",
      fromName: "Flarebot",
      fromAddress: "bot@example.com",
    },
  });
  const flags = await page.request.put(
    `/api/status-pages/${pageId}/subscriptions`,
    {
      headers: { origin, "content-type": "application/json" },
      data: { email: true, webhook: true, rss: true },
    },
  );
  expect(flags.ok(), await flags.text()).toBeTruthy();

  await page.goto(`/console/status-pages/${pageId}`);
  await expect(
    page.getByRole("heading", { name: "Subscriptions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Email subscriptions" }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Webhook subscriptions" }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "RSS and Atom feeds" }),
  ).toBeChecked();
  await expect(
    page.getByText("Email is hidden on the public page"),
  ).toHaveCount(0);
  await expect(page.getByText(/rate limits/)).toBeVisible();
  mkdirSync(shots, { recursive: true });
  await page.screenshot({
    path: `${shots}/subscriptions-console.png`,
    fullPage: true,
  });

  await page.goto("/console/settings");
  await expect(
    page.getByRole("heading", { name: "Subscribe bot check" }),
  ).toBeVisible();
  await expect(page.getByLabel("Turnstile site key")).toBeVisible();
  await page.screenshot({
    path: `${shots}/subscriptions-settings.png`,
    fullPage: true,
  });

  await page.goto(`/s/${slug}`);
  await expect(
    page.getByRole("button", { name: "Subscribe to updates" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Subscribe to updates" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "All components on this page" }),
  ).toBeChecked();
  await page.getByLabel("Email address").fill(`visitor-${stamp}@example.com`);
  await page.screenshot({
    path: `${shots}/subscriptions-dialog.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `${shots}/subscriptions-dialog-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  const feed = await page.request.get(`/s/${slug}/feed.rss`);
  expect(feed.ok()).toBeTruthy();
  expect(feed.headers()["content-type"]).toContain("rss");
});

test("the subscribe dialog renders the bot check when a site key is set", async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now().toString(36);
  const slug = `sub-ts-${stamp}`;
  const monitorId = await createHeartbeat(page, `Turnstile beat ${stamp}`);
  const created = await page.request.post("/api/status-pages", {
    headers: { origin, "content-type": "application/json" },
    data: {
      slug,
      published: true,
      title: `Turnstile page ${stamp}`,
      description: "",
      items: [{ monitorId, position: 0, groupName: "", displayName: "" }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const pageId = ((await created.json()) as { id: string }).id;
  const flags = await page.request.put(
    `/api/status-pages/${pageId}/subscriptions`,
    {
      headers: { origin, "content-type": "application/json" },
      data: { email: false, webhook: true, rss: false },
    },
  );
  expect(flags.ok(), await flags.text()).toBeTruthy();

  // The site key is an instance setting. Patching the response keeps this
  // test from changing it for the specs that run next to it.
  await page.route(`**/api/public/status/${slug}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      subscriptions: { turnstileSiteKey: string | null };
    };
    body.subscriptions.turnstileSiteKey = "test-site-key";
    await route.fulfill({ response, json: body });
  });
  await page.route("**/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(node, options) {
          node.setAttribute("data-sitekey", options.sitekey);
          node.textContent = "bot check";
          options.callback("stub-token");
          return "widget-1";
        },
        reset() {},
        remove() {},
      };`,
    }),
  );
  await page.goto(`/s/${slug}`);
  await page.getByRole("button", { name: "Subscribe to updates" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-sitekey="test-site-key"]')).toHaveText(
    "bot check",
  );
});
