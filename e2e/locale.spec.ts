import { expect, test } from "@playwright/test";
import { signIn } from "./session";

test("the admin UI stays English with a non-English browser and a stale locale cookie", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.addCookies([
    {
      name: "locale",
      value: "ko",
      url: "http://127.0.0.1:4173",
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await signIn(page);
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/console/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.locator('select[name="accountLocale"]')).toHaveCount(0);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await expect(page.getByRole("menuitem", { name: "Korean" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await context.close();
});
