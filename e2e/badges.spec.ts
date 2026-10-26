import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { origin, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";

test("enables a badge, previews it, and copies the public URL", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await signIn(page);
  const stamp = Date.now().toString(36);
  const name = `Badge Web ${stamp}`;
  const created = await page.request.post("/api/monitors", {
    headers: {
      origin,
      "content-type": "application/json",
    },
    data: {
      name,
      type: "heartbeat",
      config: { graceSeconds: 30 },
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = ((await created.json()) as { id: string }).id;

  await page.goto(`/console/monitors/${id}`);
  await expect(page.getByRole("heading", { name: "Badges" })).toBeVisible();
  await expect(
    page.getByText("The public URL returns an unknown badge."),
  ).toBeVisible();
  const hidden = await page.request.get(`/badge/${id}/status.svg`);
  expect(hidden.ok()).toBeTruthy();
  expect(hidden.headers()["content-type"]).toContain("image/svg+xml");
  expect(await hidden.text()).toContain("unknown");

  const toggle = page.getByRole("switch", {
    name: "Allow badges when this monitor is not on a public page",
  });
  await expect(toggle).toBeEnabled();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/monitors/${id}/badges`) &&
      response.request().method() === "PATCH",
  );
  await toggle.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(
    page.getByText("The switch is on, so the public badge URL is available."),
  ).toBeVisible();

  const status = await page.request.get(`/badge/${id}/status.svg`);
  expect(status.ok()).toBeTruthy();
  expect(await status.text()).not.toContain(">unknown<");
  await expect(
    page.getByRole("img", { name: "Preview of the Status badge" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "For the badge" }).click();
  await page.getByRole("button", { name: "7 days" }).click();
  await page.getByLabel("Label").fill("Edge");
  await page.getByRole("button", { name: "Copy URL" }).first().click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: `${shots}/badges-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/badges-mobile.png`,
    fullPage: true,
  });
  await expectNoHorizontalOverflow(page);
});

async function expectNoHorizontalOverflow(page: Page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
}
