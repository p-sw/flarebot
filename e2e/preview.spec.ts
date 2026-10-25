import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("brand preview screenshots", async ({ page }) => {
  mkdirSync(".brand-preview", { recursive: true });
  await page.goto("/");
  const heading = page.getByRole("heading", {
    name: /Set up Flarebot|Sign in|Dashboard/,
  });
  await expect(heading.first()).toBeVisible();
  if (await page.getByRole("heading", { name: "Sign in" }).isVisible()) {
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("flarebot-pass");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.screenshot({
    path: ".brand-preview/dashboard-light-desktop.png",
    fullPage: true,
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: ".brand-preview/dashboard-dark-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".brand-preview/dashboard-dark-mobile.png",
    fullPage: true,
  });
});
