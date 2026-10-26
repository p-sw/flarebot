// SPDX-License-Identifier: MIT

import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createHeartbeat, origin, signIn } from "./session";

const shots = "/opt/cursor/artifacts/screenshots";

test.describe("incidents and maintenance", () => {
  test.setTimeout(60_000);

  test("creates an incident and a maintenance window and shows both publicly", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const monitorName = `Announce beat ${stamp}`;
    const pageTitle = `Announce page ${stamp}`;
    const incidentTitle = `Checkout ${stamp}`;
    const windowTitle = `Deploy ${stamp}`;
    const slug = `ann-${stamp}`;
    const monitorId = await createHeartbeat(page, monitorName);
    const createdPage = await page.request.post("/api/status-pages", {
      headers: { origin, "content-type": "application/json" },
      data: {
        slug,
        published: true,
        title: pageTitle,
        description: "Public services",
        items: [
          {
            monitorId,
            position: 0,
            groupName: "Core",
            displayName: monitorName,
          },
        ],
      },
    });
    expect(createdPage.ok(), await createdPage.text()).toBeTruthy();

    await page.goto("/console/incidents/new");
    await expect(
      page.getByRole("heading", { name: "New incident" }),
    ).toBeVisible();
    await page.getByLabel("Title").fill(incidentTitle);
    await page
      .getByRole("checkbox", { name: monitorName, exact: true })
      .check();
    await page.getByRole("checkbox", { name: pageTitle, exact: true }).check();
    await page.getByLabel("Impact").selectOption("partial_outage");
    await page.getByLabel("Message").fill("We are **looking** into the API.");
    await page.route("**/api/incidents", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.getByRole("button", { name: "Create" }).click();
    const working = page.getByRole("button", { name: "Working" });
    await expect(working).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Edit incident" }),
    ).toBeVisible();
    await expect(page.getByText("looking", { exact: true })).toBeVisible();
    mkdirSync(shots, { recursive: true });
    await page.screenshot({
      path: `${shots}/incident-timeline.png`,
      fullPage: true,
    });

    await page.getByRole("link", { name: "Maintenance" }).click();
    await expect(
      page.getByRole("heading", { name: "Maintenance", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "New maintenance" }).click();
    await expect(
      page.getByRole("heading", { name: "New maintenance" }),
    ).toBeVisible();
    await page.getByLabel("Title").fill(windowTitle);
    await page.getByLabel("Description").fill("Rolling out the database.");
    await page
      .getByRole("checkbox", { name: monitorName, exact: true })
      .check();
    await page.getByRole("checkbox", { name: pageTitle, exact: true }).check();
    await page.getByRole("button", { name: "Weekly", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Mon", exact: true }),
    ).toBeVisible();
    await expect(page.locator("ol li")).toHaveCount(5);
    await page.screenshot({
      path: `${shots}/maintenance-recurrence.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Create" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit maintenance" }),
    ).toBeVisible();

    await page.goto(`/s/${slug}`);
    await expect(
      page.getByRole("heading", { name: incidentTitle }),
    ).toBeVisible();
    await expect(page.getByText("Partial outage").first()).toBeVisible();
    await expect(page.getByText(windowTitle)).toBeVisible();
    await expect(page.getByText("Upcoming").first()).toBeVisible();
    await page.screenshot({
      path: `${shots}/public-announcements.png`,
      fullPage: true,
    });

    await page.getByRole("link", { name: incidentTitle }).click();
    await expect(
      page.getByRole("heading", { name: incidentTitle }),
    ).toBeVisible();
    await expect(page.getByText("looking", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/s/${slug}`);
    await expect(page.getByText(incidentTitle)).toBeVisible();
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
    await page.screenshot({
      path: `${shots}/public-announcements-mobile.png`,
      fullPage: true,
    });
  });
});
