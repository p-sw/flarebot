import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./session";

test("brand preview screenshots", async ({ page }) => {
  mkdirSync(".brand-preview", { recursive: true });
  await signIn(page);
  await page.goto("/console");
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
