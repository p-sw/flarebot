import { mkdirSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
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
    const alphaId = await createHttp(
      page,
      alpha,
      `https://alpha-${stamp}.example/health`,
    );
    await createHttp(page, beta, `https://beta-${stamp}.example/health`);
    const slug = `edit-${stamp}`;
    const created = await page.request.post("/api/status-pages", {
      headers: {
        origin: "http://127.0.0.1:4173",
        "content-type": "application/json",
      },
      data: {
        slug,
        published: true,
        title: `Edit me ${stamp}`,
        description: "Before",
        items: [
          {
            monitorId: alphaId,
            position: 0,
            groupName: "Edge",
            displayName: "",
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
    const edge = page.getByRole("article", { name: "Edge" });
    await addMonitor(edge, beta);
    const betaHandle = edge.getByRole("button", {
      name: `Drag to reorder ${beta}`,
    });
    await betaHandle.dragTo(
      edge.getByRole("button", { name: `Drag to reorder ${alpha}` }),
    );
    const edgeItems = edge.getByRole("list", { name: "Monitors in Edge" });
    await expect(edgeItems.getByRole("listitem").nth(0)).toContainText(beta);
    await expect(edgeItems.getByRole("listitem").nth(1)).toContainText(alpha);
    const betaRow = edgeItems.getByRole("listitem").nth(0);
    await betaRow
      .getByRole("textbox", { name: "Display name" })
      .fill("Public beta");
    await expect(betaRow.getByText(`Monitor: ${beta}`)).toBeVisible();
    await page.getByRole("button", { name: "Add section" }).click();
    await page
      .getByRole("textbox", { name: "Section name" })
      .nth(1)
      .fill("Core");
    await edge.getByRole("button", { name: "Actions for Public beta" }).click();
    await page
      .getByRole("menuitem", { name: "Move Public beta to the next section" })
      .click();
    const core = page.getByRole("article", { name: "Core" });
    await core.getByRole("button", { name: "Drag to reorder Core" }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("article").first()).toHaveAttribute(
      "aria-label",
      "Core",
    );
    await page.route("**/api/status-pages/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(
      page.getByRole("button", { name: "Working…" }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add section" }),
    ).toBeDisabled();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-editor-desktop.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${shots}/status-builder-after-edit-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${shots}/status-editor-mobile.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${shots}/status-builder-after-edit-mobile.png`,
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
    await expect(monitors.nth(0)).toHaveText("Public beta");
    await expect(monitors.nth(1)).toHaveText(alpha);
  });

  test("keeps the monitor name visible after a display name is set", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const name = `Main Web ${stamp}`;
    await createHeartbeat(page, name);
    await page.goto("/console/status-pages/new");
    await page.getByRole("button", { name: "Add section" }).click();
    const section = page.locator("article").first();
    await addMonitor(section, name);
    const display = section.getByRole("textbox", { name: "Display name" });
    await display.fill("Public edge");
    await expect(display).toHaveValue("Public edge");
    await expect(section.getByText(`Monitor: ${name}`)).toBeVisible();
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-editor-display-name.png`,
      fullPage: true,
    });
    await display.fill("");
    await expect(display).toHaveValue("");
    await expect(section.getByText(`Monitor: ${name}`)).toBeVisible();
    await expect(section.getByText("Public edge")).toHaveCount(0);
  });

  test("creates a page with two ordered sections and monitor names", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const alpha = `Alpha create ${stamp}`;
    const beta = `Beta create ${stamp}`;
    const alphaUrl = `https://alpha-${stamp}.example/health`;
    await createHttp(page, alpha, alphaUrl);
    await createHttp(page, beta, `https://beta-${stamp}.example/health`);
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
    await expect(page.getByText("No sections yet")).toBeVisible();
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByRole("textbox", { name: "Section name" }).fill("Core");
    const core = page.getByRole("article", { name: "Core" });
    const combo = core.getByRole("combobox", { name: "Choose a monitor" });
    await combo.click();
    await combo.fill("zzzz-no-monitor");
    await expect(
      page.getByText("No monitors match that search."),
    ).toBeVisible();
    await combo.fill(`alpha-${stamp}.example`);
    await expect(page.getByRole("option", { name: alpha })).toContainText(
      alphaUrl,
    );
    await expect(page.getByRole("option", { name: beta })).toHaveCount(0);
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-builder-after-picker-desktop.png`,
      fullPage: true,
    });
    await page.getByRole("option", { name: alpha }).click();
    await expect(core.getByText(`Monitor: ${alpha}`)).toBeVisible();
    await page.getByRole("button", { name: "Add section" }).click();
    await page
      .getByRole("textbox", { name: "Section name" })
      .nth(1)
      .fill("Edge");
    const edge = page.getByRole("article", { name: "Edge" });
    const edgeCombo = edge.getByRole("combobox", { name: "Choose a monitor" });
    await edgeCombo.click();
    await edgeCombo.fill(alpha);
    await expect(
      edge.getByText("No monitors match that search."),
    ).toBeVisible();
    await edgeCombo.fill(beta);
    await page.getByRole("option", { name: beta }).click();
    await edge
      .getByRole("button", { name: "Drag to reorder Edge" })
      .dragTo(core.getByRole("button", { name: "Drag to reorder Core" }));
    await expect(page.getByRole("article").first()).toHaveAttribute(
      "aria-label",
      "Edge",
    );
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: `${shots}/status-create-desktop.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${shots}/status-builder-after-create-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${shots}/status-create-mobile.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${shots}/status-builder-after-create-mobile.png`,
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

async function createHttp(page: Page, name: string, url: string) {
  const created = await page.request.post("/api/monitors", {
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
    },
    data: {
      name,
      type: "http",
      config: { url },
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
    },
  });
  expect(created.ok()).toBeTruthy();
  return ((await created.json()) as { id: string }).id;
}

async function addMonitor(section: Locator, name: string) {
  const combo = section.getByRole("combobox", { name: "Choose a monitor" });
  await combo.click();
  await combo.fill(name);
  await section.page().getByRole("option", { name }).click();
}

async function createStatusPage(page: Page, slug: string, title: string) {
  const created = await page.request.post("/api/status-pages", {
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
    },
    data: {
      slug,
      published: true,
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
