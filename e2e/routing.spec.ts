import { expect, type Page, test } from "@playwright/test";
import { email, origin, password, signIn } from "./session";

const json = {
  origin,
  "content-type": "application/json",
};

test("root status page and console routing", async ({ page }) => {
  await signIn(page);
  await clearRoots(page);
  await page.context().clearCookies();

  const home = await page.goto("/");
  expect(home?.request().redirectedFrom()?.url()).toBe(`${origin}/`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);

  await page.goto("/console/status-pages");
  await expect(page).toHaveURL(/\/login\?next=%2Fconsole%2Fstatus-pages$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/console\/status-pages$/);
  await expect(
    page.getByRole("heading", { name: "Status pages" }),
  ).toBeVisible();

  const bounced = await page.goto("/login?next=https://evil.example");
  expect(bounced?.request().redirectedFrom()?.url()).toContain("/login");
  expect(bounced?.url()).toBe(`${origin}/console`);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const stamp = Date.now().toString(36);
  const alpha = `Root Alpha ${stamp}`;
  const beta = `Root Beta ${stamp}`;
  const slugA = `e2e-a-${stamp}`;
  const slugB = `e2e-b-${stamp}`;
  await createPage(page, slugA, alpha);
  await createPage(page, slugB, beta);

  try {
    await page.goto("/console/status-pages");
    const alphaCard = page.getByRole("article").filter({ hasText: alpha });
    const betaCard = page.getByRole("article").filter({ hasText: beta });
    await expect(alphaCard.getByText(/Only one status page/)).toBeVisible();
    await expect(
      betaCard.getByText(/turns it off for every other page/),
    ).toBeVisible();
    await alphaCard
      .getByRole("switch", { name: "Serve at the site root" })
      .click();
    await expect(
      alphaCard.getByText("This page is the home page."),
    ).toBeVisible();

    const rooted = await page.goto("/");
    expect(rooted?.status()).toBe(200);
    expect(rooted?.request().redirectedFrom()).toBeNull();
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle(alpha);
    await expect(page.getByRole("heading", { name: alpha })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(
      0,
    );

    await page.goto("/console/status-pages");
    await betaCard
      .getByRole("switch", { name: "Serve at the site root" })
      .click();
    await expect(betaCard.getByRole("switch")).toBeChecked();
    await expect(alphaCard.getByRole("switch")).not.toBeChecked();
    await expect(
      betaCard.getByText("This page is the home page."),
    ).toBeVisible();

    const moved = await page.goto("/");
    expect(moved?.status()).toBe(200);
    await expect(page).toHaveTitle(beta);
    await expect(page.getByRole("heading", { name: beta })).toBeVisible();
    await page.goto(`/s/${slugA}`);
    await expect(page.getByRole("heading", { name: alpha })).toBeVisible();
    await page.goto(`/s/${slugB}`);
    await expect(page.getByRole("heading", { name: beta })).toBeVisible();
  } finally {
    await signIn(page);
    await clearRoots(page);
  }
});

async function createPage(
  page: Page,
  slug: string,
  title: string,
): Promise<void> {
  const created = await page.request.post("/api/status-pages", {
    headers: json,
    data: {
      slug,
      published: true,
      title,
      description: "",
      items: [],
    },
  });
  if (!created.ok()) {
    throw new Error(
      `create status page failed: ${created.status()} ${await created.text()}`,
    );
  }
}

async function clearRoots(page: Page): Promise<void> {
  const listed = await page.request.get("/api/status-pages", { headers: json });
  if (!listed.ok()) return;
  const body = (await listed.json()) as {
    pages: { id: string; serveAtRoot: boolean }[];
  };
  for (const item of body.pages) {
    if (!item.serveAtRoot) continue;
    await page.request.put(`/api/status-pages/${item.id}/root`, {
      headers: json,
      data: { serveAtRoot: false },
    });
  }
}
