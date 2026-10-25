import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { origin, signIn } from "./session";

const korean = JSON.parse(readFileSync("locales/ko.json", "utf8")) as {
  nav_account: string;
};

test("the saved account language wins over the browser language", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "ko-KR" });
  const page = await context.newPage();
  await signIn(page);
  const email = `locale-${Date.now().toString(36)}-${test.info().parallelIndex}@example.com`;
  const invite = await page.request.post("/api/team/invites", {
    headers: { origin, "content-type": "application/json" },
    data: { role: "viewer", email },
  });
  expect(invite.ok()).toBeTruthy();
  const link = ((await invite.json()) as { link: string }).link;
  const token = link.split("/").pop() ?? "";
  const accepted = await page.request.post("/api/invites/accept", {
    headers: { origin, "content-type": "application/json" },
    data: {
      token,
      name: "Locale",
      email,
      password: "flarebot-pass",
    },
  });
  expect(accepted.ok()).toBeTruthy();
  const sessionHeader = accepted
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .join("; ");
  const session = /flarebot_session=([^;]+)/.exec(sessionHeader)?.[1];
  expect(session).toBeTruthy();
  await context.addCookies([
    {
      name: "flarebot_session",
      value: session ?? "",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  const select = page.locator('select[name="accountLocale"]');
  await expect(select).toHaveValue("en");

  await select.selectOption("ko");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", { name: korean.nav_account }),
  ).toBeVisible();
  await expect(page.locator('select[name="accountLocale"]')).toHaveValue("ko");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: korean.nav_account }),
  ).toBeVisible();
  await expect(page.locator('select[name="accountLocale"]')).toHaveValue("ko");
  await context.close();
});
