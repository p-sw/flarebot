import { expect, test } from "@playwright/test";
import { createHeartbeat, signIn } from "./session";

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const box = await page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const offenders: string[] = [];
    for (const node of document.body.querySelectorAll("*")) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.classList.contains("sr-only")) continue;
      const style = getComputedStyle(node);
      if (
        style.position === "fixed" ||
        style.position === "sticky" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }
      let ancestor = node.parentElement;
      let insideFixed = false;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (
          ancestorStyle.position === "fixed" ||
          ancestorStyle.position === "sticky"
        ) {
          insideFixed = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (insideFixed) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      let clipped = false;
      let parent = node.parentElement;
      while (parent) {
        const parentStyle = getComputedStyle(parent);
        const overflow = parentStyle.overflowX;
        if (
          overflow === "auto" ||
          overflow === "hidden" ||
          overflow === "scroll" ||
          overflow === "clip"
        ) {
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.left >= -1 && parentRect.right <= width + 1) {
            clipped = true;
            break;
          }
        }
        parent = parent.parentElement;
      }
      if (clipped) continue;
      const id = node.id ? `#${node.id}` : "";
      const className =
        typeof node.className === "string"
          ? node.className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
      const label =
        node.getAttribute("aria-label") ?? node.getAttribute("name") ?? "";
      offenders.push(
        `${location.pathname} ${node.tagName}${id}${className ? `.${className}` : ""}${label ? ` "${label}"` : ""} left=${Math.round(rect.left)} right=${Math.round(rect.right)} ${node.outerHTML.slice(0, 140)}`,
      );
      if (offenders.length >= 8) break;
    }
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: width,
      offenders,
    };
  });
  expect(box.offenders, box.offenders.join("\n")).toEqual([]);
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
}

const widths = [320, 360, 390, 414] as const;

async function expectNoOverflowAtWidths(page: import("@playwright/test").Page) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(50);
    await expectNoHorizontalOverflow(page);
  }
}

test("key pages do not overflow at mobile widths", async ({ page }) => {
  test.setTimeout(90_000);
  const slug = `mobile-${test.info().parallelIndex}-${Date.now().toString(36)}`;
  const longName = `Billing API ${"Northstar ".repeat(6)}monitor`;
  await signIn(page);
  const id = await createHeartbeat(page, longName);
  const created = await page.request.post("/api/status-pages", {
    headers: {
      origin: "http://127.0.0.1:4173",
      "content-type": "application/json",
    },
    data: {
      slug,
      published: true,
      title:
        "Mobile status with a long heading that must stay inside the viewport",
      description: "Narrow layout",
      items: [
        {
          monitorId: id,
          position: 0,
          groupName: "Core services with a long section name",
          displayName: longName,
        },
        {
          monitorId: id,
          position: 1,
          groupName: "Core services with a long section name",
          displayName: "",
        },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const pageId = ((await created.json()) as { id: string }).id;

  const signedIn = [
    "/console",
    "/console/monitors/new",
    `/console/monitors/${id}`,
    `/console/monitors/${id}/edit`,
    "/console/status-pages",
    `/console/status-pages/${pageId}`,
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
