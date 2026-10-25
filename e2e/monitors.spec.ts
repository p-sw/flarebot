import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { origin, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";

test("shows the full check configuration and applies an edit without a reload", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await signIn(page);
  const stamp = Date.now().toString(36);
  const name = `Main Web ${stamp}`;
  const renamed = `Ready Web ${stamp}`;
  const created = await page.request.post("/api/monitors", {
    headers: {
      origin,
      "content-type": "application/json",
    },
    data: {
      name,
      type: "http",
      config: {
        url: "https://example.com/health",
        method: "POST",
        headers: [
          { name: "Authorization", value: "Bearer secret-token" },
          { name: "Accept", value: "application/json" },
        ],
        body: '{"ping":true}',
        followRedirects: false,
        expectedStatuses: [200, 204],
        keyword: "ok",
        keywordMode: "present",
      },
      intervalSeconds: 60,
      timeoutSeconds: 12,
      retries: 3,
      recoveryThreshold: 2,
      channelIds: [],
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = ((await created.json()) as { id: string }).id;
  const slug = `cfg-${stamp}`;
  const pageResponse = await page.request.post("/api/status-pages", {
    headers: {
      origin,
      "content-type": "application/json",
    },
    data: {
      slug,
      published: true,
      title: `Config page ${stamp}`,
      description: "",
      items: [
        {
          monitorId: id,
          position: 0,
          groupName: "",
          displayName: "",
        },
      ],
    },
  });
  expect(pageResponse.ok()).toBeTruthy();

  await page.goto(`/console/monitors/${id}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("https://example.com/health")).toBeVisible();
  await expect(page.getByText("POST", { exact: true })).toBeVisible();
  await expect(page.getByText("200, 204")).toBeVisible();
  await expect(page.getByText("application/json")).toBeVisible();
  await expect(page.getByText("Bearer secret-token")).toHaveCount(0);
  await expect(page.getByText("••••••••").first()).toBeVisible();
  await page.getByRole("button", { name: "Show header values" }).click();
  await expect(page.getByText("Bearer secret-token")).toBeVisible();
  await expect(page.getByText('{"ping":true}')).toBeVisible();
  await expect(page.getByText("No", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`Config page ${stamp}`)).toBeVisible();
  await expect(page.getByText("Created", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated", { exact: true })).toBeVisible();

  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: `${shots}/monitor-detail-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/monitor-detail-mobile.png`,
    fullPage: true,
  });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit monitor" }),
  ).toBeVisible();
  await page.locator('input[name="name"]').fill(renamed);
  await page.locator('input[name="url"]').fill("https://example.com/ready");
  await page.locator('input[name="interval"]').fill("120");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: `${shots}/monitor-edit-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/console/monitors/${id}(\\?|$)`));
  await expect(page).not.toHaveURL(/\/edit/);
  await expect(
    page.getByText(
      "Saved. This page shows the configuration the scheduler is using.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  await expect(page.getByText("https://example.com/ready")).toBeVisible();
  await expect(page.getByText("https://example.com/health")).toHaveCount(0);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(renamed)).toBeVisible();
  await expect(page.getByText("https://example.com/ready")).toBeVisible();
  await page.getByRole("link", { name: renamed }).click();
  await expect(page.getByText("120", { exact: true }).first()).toBeVisible();
});

async function expectNoHorizontalOverflow(page: Page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
}
