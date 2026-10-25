import { expect, type Page, test } from "@playwright/test";
import { createHeartbeat, signIn } from "./session";

function monitorCard(page: Page, name: string) {
  return page
    .getByRole("link", { name })
    .locator("xpath=ancestor::*[contains(@class,'rounded-lg')][1]");
}

test("pause and resume update every screen without a reload", async ({
  page,
}) => {
  await signIn(page);
  const name = `Pause ${test.info().parallelIndex} ${Date.now().toString(36)}`;
  await createHeartbeat(page, name);

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/monitors/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await gate;
    await route.continue();
  });

  await page.goto("/console");
  const card = monitorCard(page, name);
  const pause = card.getByRole("button", { name: "Pause" });
  await expect(pause).toBeVisible();
  await expect(card.getByText("Checking", { exact: true })).toBeVisible();

  await pause.click();
  await expect(pause).toBeDisabled();
  await expect(pause.locator("svg.animate-spin")).toBeVisible();
  await expect(pause).toHaveAccessibleName("Pause");
  release();

  await expect(card.getByRole("button", { name: "Resume" })).toBeEnabled();
  await expect(card.getByText("Paused", { exact: true })).toBeVisible();
  await expect(card.getByText("Checking", { exact: true })).toHaveCount(0);

  await card.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(card.getByText("Paused", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(card.getByText("Checking", { exact: true })).toBeVisible();
  await expect(card.getByText("Paused", { exact: true })).toHaveCount(0);
});

test("a failed pause keeps the previous status and explains why", async ({
  page,
}) => {
  await signIn(page);
  const name = `Pause fail ${test.info().parallelIndex} ${Date.now().toString(36)}`;
  await createHeartbeat(page, name);
  await page.route("**/api/monitors/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal", message: "nope" },
      }),
    });
  });

  await page.goto("/console");
  const card = monitorCard(page, name);
  await expect(card.getByText("Checking", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not pause or resume this monitor. Nothing was changed.",
  );
  await expect(card.getByRole("button", { name: "Pause" })).toBeEnabled();
  await expect(card.getByText("Paused", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Checking", { exact: true })).toBeVisible();
});
