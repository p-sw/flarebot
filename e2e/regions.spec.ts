import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { origin, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";
const json = { origin, "content-type": "application/json" };

test("saves the global check region and a per-monitor override", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await signIn(page);
  try {
    await page.goto("/console/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const settings = page.getByRole("form", { name: "Check region" });
    await settings.getByRole("combobox").click();
    await page
      .getByRole("option", { name: "Asia-Pacific", exact: true })
      .click();
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/settings-region-desktop.png`,
      fullPage: true,
    });
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(settings.getByRole("status")).toContainText("Saved");

    const stamp = Date.now().toString(36);
    const name = `Region ${stamp}`;
    const created = await page.request.post("/api/monitors", {
      headers: json,
      data: {
        name,
        type: "http",
        config: {
          url: "https://example.com/region",
          method: "GET",
          followRedirects: true,
          expectedStatuses: [200],
        },
        intervalSeconds: 60,
        timeoutSeconds: 10,
        retries: 1,
        recoveryThreshold: 1,
        channelIds: [],
        region: "inherit",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const id = ((await created.json()) as { id: string }).id;

    await page.goto(`/console/monitors/${id}`);
    await expect(page.getByText("Asia-Pacific")).toBeVisible();
    await expect(page.getByText("From the global setting")).toBeVisible();
    await expect(
      page.getByText("Response time (TTFB) ·", { exact: false }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit monitor" }),
    ).toBeVisible();
    const form = page.locator("form");
    await form.getByRole("combobox", { name: /Check region/ }).click();
    await page
      .getByRole("option", { name: "Western Europe", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${shots}/monitor-region-mobile.png`,
      fullPage: true,
    });
    await expectNoHorizontalOverflow(page);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(new RegExp(`/console/monitors/${id}(\\?|$)`));
    await expect(page.getByText("Western Europe")).toBeVisible();
    await expect(page.getByText("Override for this monitor")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/console");
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText("Western Europe").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/monitor-region-list-mobile.png`,
      fullPage: true,
    });
  } finally {
    await page.request.put("/api/settings", {
      headers: json,
      data: { checkRegion: "auto" },
    });
  }
});

async function expectNoHorizontalOverflow(page: Page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
}
