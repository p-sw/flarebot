import { expect, test } from "@playwright/test";
import { signIn } from "./session";

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hamburger opens, navigates, and does not overflow", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/console");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    const openMenu = page.getByRole("button", { name: "Open menu" });
    await openMenu.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Notifications" }),
    ).toBeVisible();

    const focusedInside = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector('[role="dialog"]');
      return panel?.contains(active) ?? false;
    });
    expect(focusedInside).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await openMenu.click();
    await page
      .getByTestId("nav-overlay")
      .click({ position: { x: 360, y: 120 } });
    await expect(dialog).toBeHidden();

    await openMenu.click();
    await dialog.getByRole("link", { name: "Notifications" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

test("a pending indicator appears during slow navigation", async ({ page }) => {
  await signIn(page);
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.route("**/api/channels", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(
    page.getByRole("progressbar", { name: "Loading" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
});
