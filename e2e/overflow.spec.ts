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
    "/",
    "/monitors/new",
    `/monitors/${id}`,
    "/status-pages",
    "/channels",
    "/team",
    "/tokens",
    "/audit",
    "/settings",
    "/account",
  ];
  const signedOut = ["/login", "/forgot", "/setup", `/s/${slug}`];

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of signedIn) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    }
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    for (const path of signedOut) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    }
    await signIn(page);
  }
});
