import { expect, test } from "@playwright/test";
import { signIn } from "./session";

test("email test uses the unsaved form and explains a blocked host", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/console/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const mail = page.locator("form").filter({ has: page.getByLabel("Driver") });
  await expect(mail.getByLabel("Driver")).toHaveValue("none");
  await expect(
    page.getByText(
      "Choose SMTP or Cloudflare Email Service before sending a test.",
    ),
  ).toBeVisible();
  await expect(mail.getByRole("button", { name: "Send test" })).toBeDisabled();

  await mail.getByLabel("Driver").selectOption("smtp");
  await expect(
    page.getByText("Fill in the required fields before sending a test."),
  ).toBeVisible();
  await expect(mail.getByRole("button", { name: "Send test" })).toBeDisabled();
  await expect(page.getByText(/DNS-only/)).toBeVisible();
  await expect(page.getByText("Port 25 is blocked.")).toBeVisible();

  await mail.getByLabel("SMTP host").fill("192.168.1.50");
  await mail.getByLabel("Port").selectOption("587");
  await mail.getByLabel("Security").selectOption("starttls");
  await mail.getByLabel("Username").fill("bot");
  await mail.getByLabel("Password").fill("secret");
  await mail.getByLabel("From name").fill("Flarebot");
  await mail.locator('input[name="from"]').fill("bot@example.com");
  await expect(mail.getByLabel("Send a test to")).toHaveValue("");
  await expect(
    page.getByText("Send test uses the values in this form."),
  ).toBeVisible();
  await expect(mail.getByRole("button", { name: "Send test" })).toBeEnabled();

  let sawDisabled = false;
  await page.route("**/api/settings/mail/test", async (route) => {
    await expect(mail.getByRole("button", { name: "Working…" })).toBeDisabled();
    await expect(mail.getByRole("button", { name: "Save" })).toBeDisabled();
    sawDisabled = true;
    await route.continue();
  });
  await mail.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "private, local, or not reachable",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    "Test failed: config",
  );
  expect(sawDisabled).toBe(true);

  const saved = await page.request.get("/api/settings/mail");
  expect(saved.ok()).toBeTruthy();
  const body = (await saved.json()) as { driver: string; host: string };
  expect(body.driver).toBe("none");
  expect(body.host).toBe("");
});
