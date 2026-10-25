import { expect, test } from "@playwright/test";
import { createHeartbeat, signIn } from "./session";

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
}

const widths = [360, 390] as const;

async function expectNoOverflowAtWidths(page: import("@playwright/test").Page) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page);
  }
}

test("key pages do not overflow at mobile widths", async ({ page }) => {
  const slug = `mobile-${test.info().parallelIndex}-${Date.now().toString(36)}`;
  await signIn(page);
  const id = await createHeartbeat(page, "Mobile heartbeat");
  const created = await page.request.post("/api/status-pages", {
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
    },
    data: {
      slug,
      published: true,
      defaultLocale: "en",
      locales: ["en", "ko"],
      sourceLocale: "en",
      title: "Mobile status",
      description: "Narrow layout",
      items: [
        {
          monitorId: id,
          position: 0,
          groupName: "Core",
          displayName: "Mobile heartbeat with a long public name",
          sourceLocale: "en",
        },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();

  const signedIn = [
    "/console",
    "/console/monitors/new",
    `/console/monitors/${id}`,
    "/console/status-pages",
    "/console/channels",
    "/console/team",
    "/console/tokens",
    "/console/audit",
    "/console/settings",
    "/console/account",
  ];
  const signedOut = ["/login", "/forgot", "/setup", `/s/${slug}`];

  // Reload each route once. Measuring both widths on that document stays
  // inside the suite timeout; a second full pass was what CI aborted.
  for (const path of signedIn) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoOverflowAtWidths(page);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/console");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  for (const path of signedOut) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoOverflowAtWidths(page);
  }
});
