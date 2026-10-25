import { expect, test } from "@playwright/test";
import { createHeartbeat, origin, signIn } from "./session";

test("dashboard is visible after sign-in", async ({ page }) => {
  await signIn(page);
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("a heartbeat monitor opens from the API id", async ({ page }) => {
  await signIn(page);
  const name = `Smoke heartbeat ${test.info().parallelIndex}`;
  const id = await createHeartbeat(page, name);
  await page.goto(`/monitors/${id}`);
  await expect(page).toHaveURL(new RegExp(`/console/monitors/${id}$`));
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("a status page renders the monitor title", async ({ page }) => {
  await signIn(page);
  const name = `Status heartbeat ${test.info().parallelIndex}`;
  const id = await createHeartbeat(page, name);
  const slug = `smoke-${test.info().parallelIndex}-${Date.now().toString(36)}`;
  const created = await page.request.post("/api/status-pages", {
    headers: { origin, "content-type": "application/json" },
    data: {
      slug,
      published: true,
      title: "Public status",
      description: "API smoke",
      items: [
        {
          monitorId: id,
          position: 0,
          groupName: "",
          displayName: name,
        },
      ],
    },
  });
  if (!created.ok()) {
    throw new Error(
      `create status page failed: ${created.status()} ${await created.text()}`,
    );
  }
  await page.goto(`/s/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Public status" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Korean" })).toHaveCount(0);
  await expect(page.getByText(name)).toBeVisible();
});

test("sign-out returns to the sign-in form", async ({ page }) => {
  await signIn(page);
  await page.goto("/console");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
