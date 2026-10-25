import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createHeartbeat, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";

test.describe("status page editor", () => {
  test.setTimeout(40_000);

  test("root switch stays disabled with a spinner until the server confirms", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const title = `Root guard ${stamp}`;
    await createStatusPage(page, `root-guard-${stamp}`, title);
    await page.goto("/console/status-pages");
    const card = page.getByRole("article").filter({ hasText: title });
    const toggle = card.getByRole("switch", { name: "Serve at the site root" });
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await page.route("**/api/status-pages/*/root", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await toggle.click();
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
    await expect(card.getByRole("status")).toBeVisible();
    mkdirSync(shots, { recursive: true });
    await page.screenshot({
      path: `${shots}/status-root-switch-pending.png`,
      fullPage: true,
    });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    await expect(card.getByText("This page is the home page.")).toBeVisible();
  });

  test("edits a page, reorders monitors, and shows names on the public page", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const alpha = `Alpha edit ${stamp}`;
    const beta = `Beta edit ${stamp}`;
    const alphaId = await createHeartbeat(page, alpha);
    await createHeartbeat(page, beta);
    const slug = `edit-${stamp}`;
    const created = await page.request.post("/api/status-pages", {
      headers: {
        origin: "http://127.0.0.1:4173",
        "content-type": "application/json",
      },
      data: {
        slug,
        published: true,
        defaultLocale: "en",
        locales: ["en"],
        sourceLocale: "en",
        title: `Edit me ${stamp}`,
        description: "Before",
        items: [
          {
            monitorId: alphaId,
            position: 0,
            groupName: "Edge",
            displayName: "",
            sourceLocale: "en",
            i18n: {},
          },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const id = ((await created.json()) as { id: string }).id;
    await page.goto(`/console/status-pages/${id}`);
    await page.getByRole("textbox", { name: "Title" }).fill(`Edited ${stamp}`);
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("After the edit");
    await page.getByRole("button", { name: "Add section" }).click();
    const names = page.getByRole("textbox", { name: "Section name" });
    await names.nth(1).fill("Core");
    const core = page.locator("article").nth(1);
    await core.getByLabel("Choose a monitor").selectOption({ label: beta });
    await core.getByRole("button", { name: "Add monitor" }).click();
    await page.getByRole("button", { name: "Move Core up" }).click();
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-editor-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${shots}/status-editor-mobile.png`,
      fullPage: true,
    });
    await expectNoHorizontalOverflow(page);
    await page.goto(`/s/${slug}`);
    await expect(
      page.getByRole("heading", { name: `Edited ${stamp}` }),
    ).toBeVisible();
    await expect(page.getByText("After the edit")).toBeVisible();
    const headings = page.getByRole("heading");
    await expect(headings.filter({ hasText: "Core" })).toBeVisible();
    await expect(headings.filter({ hasText: "Edge" })).toBeVisible();
    const monitors = page.locator("h3");
    await expect(monitors.nth(0)).toHaveText(beta);
    await expect(monitors.nth(1)).toHaveText(alpha);
  });

  test("creates a page with two ordered sections and monitor names", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const alpha = `Alpha create ${stamp}`;
    const beta = `Beta create ${stamp}`;
    await createHeartbeat(page, alpha);
    await createHeartbeat(page, beta);
    await page.goto("/console/status-pages/new");
    await expect(
      page.getByRole("heading", { name: "New status page" }),
    ).toBeVisible();
    const title = `Created ${stamp}`;
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue(
      `created-${stamp}`,
    );
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("Created from the form");
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("textbox", { name: "Section name" }).fill("Core");
    const core = page.locator("article").nth(0);
    await core.getByLabel("Choose a monitor").selectOption({ label: alpha });
    await core.getByRole("button", { name: "Add monitor" }).click();
    await page.getByRole("button", { name: "Add section" }).click();
    await page
      .getByRole("textbox", { name: "Section name" })
      .nth(1)
      .fill("Edge");
    const edge = page.locator("article").nth(1);
    await edge.getByLabel("Choose a monitor").selectOption({ label: beta });
    await edge.getByRole("button", { name: "Add monitor" }).click();
    await page.getByRole("button", { name: "Move Edge up" }).click();
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-create-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${shots}/status-create-mobile.png`,
      fullPage: true,
    });
    await expectNoHorizontalOverflow(page);
    await page
      .getByRole("button", { name: "Create status page" })
      .last()
      .click();
    await expect(page.getByText("Status page created.")).toBeVisible();
    await expect(page).toHaveURL(/\/console\/status-pages\/[0-9a-f-]+/);
    await page.goto(`/s/created-${stamp}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const monitors = page.locator("h3");
    await expect(monitors.nth(0)).toHaveText(beta);
    await expect(monitors.nth(1)).toHaveText(alpha);
    await expect(page.getByRole("heading", { name: "Edge" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Core" })).toBeVisible();
    const order = await page.locator("h2, h3").allTextContents();
    const edgeAt = order.indexOf("Edge");
    const coreAt = order.indexOf("Core");
    const betaAt = order.indexOf(beta);
    const alphaAt = order.indexOf(alpha);
    expect(edgeAt).toBeGreaterThanOrEqual(0);
    expect(coreAt).toBeGreaterThan(edgeAt);
    expect(betaAt).toBeGreaterThan(edgeAt);
    expect(alphaAt).toBeGreaterThan(betaAt);
  });
});

async function createStatusPage(page: Page, slug: string, title: string) {
  const created = await page.request.post("/api/status-pages", {
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
    },
    data: {
      slug,
      published: true,
      defaultLocale: "en",
      locales: ["en"],
      sourceLocale: "en",
      title,
      description: "",
      items: [],
    },
  });
  expect(created.ok()).toBeTruthy();
}

async function expectNoHorizontalOverflow(page: Page) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
}
