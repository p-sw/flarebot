import { expect, type Locator, type Page, test } from "@playwright/test";
import { origin, signIn } from "./session";

const headers = { origin, "content-type": "application/json" };

type LiveAlerts = { down: string[]; degraded: string[] };

async function createHttp(
  page: Page,
  name: string,
  host: string,
  paused: boolean,
): Promise<string> {
  const created = await page.request.post("/api/monitors", {
    headers,
    data: {
      name,
      type: "http",
      // .invalid never resolves, so a running check is always down.
      config: { url: `https://${host}.invalid/api/status/proxy` },
      intervalSeconds: 60,
      timeoutSeconds: 5,
      retries: 1,
      recoveryThreshold: 1,
      channelIds: [],
      paused,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { id: string }).id;
}

async function publishPage(
  page: Page,
  slug: string,
  monitorId: string,
  displayName: string,
): Promise<string> {
  const created = await page.request.post("/api/status-pages", {
    headers,
    data: {
      slug,
      published: true,
      title: `Gallery ${slug}`,
      description: "",
      items: [{ monitorId, position: 0, groupName: "", displayName }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { id: string }).id;
}

async function removeMonitor(page: Page, id: string) {
  await page.request.delete(`/api/monitors/${id}`, { headers });
}

test.describe("automatic live notices", () => {
  test("lists a down check by name and leaves the overall alone", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const id = await createHttp(
      page,
      `Unreachable ${stamp}`,
      `down-${stamp}`,
      false,
    );
    try {
      const slug = `live-${stamp}`;
      await publishPage(page, slug, id, `Proxy ${stamp}`);
      await page.goto(`/s/${slug}`);
      await expect(page.getByText("All systems operational")).toBeVisible();
      const live = page.getByRole("region", { name: "Detected by checks" });
      await expect(
        live.getByRole("heading", { name: "Some services are down" }),
      ).toBeVisible();
      await expect(
        live.getByText(`Proxy ${stamp}`, { exact: true }),
      ).toBeVisible();
      await expect(
        live.getByText(
          "Shown automatically from the latest checks. It clears when the checks recover.",
        ),
      ).toBeVisible();
      await expect(
        live.getByRole("heading", { name: "Some services are degraded" }),
      ).toHaveCount(0);
      await expect(live).not.toContainText(`Unreachable ${stamp}`);
      await expect(live).not.toContainText(".invalid");
    } finally {
      await removeMonitor(page, id);
    }
  });

  test("puts down above degraded after incidents and maintenance, and clears", async ({
    page,
  }) => {
    await signIn(page);
    const stamp = Date.now().toString(36);
    const id = await createHttp(page, `Quiet ${stamp}`, `quiet-${stamp}`, true);
    try {
      const slug = `order-${stamp}`;
      const pageId = await publishPage(page, slug, id, `Quiet ${stamp}`);
      const now = Date.now();
      const incident = await page.request.post("/api/incidents", {
        headers,
        data: {
          title: `Slow images ${stamp}`,
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitors: [{ monitorId: id, impact: "degraded" }],
          update: { status: "investigating", body: "Looking.", postedAt: now },
        },
      });
      expect(incident.ok(), await incident.text()).toBeTruthy();
      const window = await page.request.post("/api/maintenance", {
        headers,
        data: {
          title: `Database ${stamp}`,
          description: "",
          timezone: "UTC",
          startAt: now - 60_000,
          endAt: now + 3_600_000,
          recurrence: "once",
          weekdays: [],
          notify: false,
          channelIds: [],
          pageIds: [pageId],
          monitorIds: [id],
        },
      });
      expect(window.ok(), await window.text()).toBeTruthy();

      // The page notices come from the API; serve chosen live alerts.
      let alerts: LiveAlerts = {
        down: ["Search"],
        degraded: ["Gallery API", "Images"],
      };
      await page.route(`**/api/public/status/${slug}*`, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
          response,
          json: { ...json, liveAlerts: alerts },
        });
      });

      await page.goto(`/s/${slug}`);
      const live = page.getByRole("region", { name: "Detected by checks" });
      await expect(live).toBeVisible();
      await expect(live.getByRole("heading", { level: 3 })).toHaveText([
        "Some services are down",
        "Some services are degraded",
      ]);
      await expect(live.getByText("Search", { exact: true })).toBeVisible();
      await expect(
        live.getByText("Gallery API, Images", { exact: true }),
      ).toBeVisible();
      const hero = await page.getByText("Some systems are down").count();
      expect(hero).toBe(1);

      const incidents = page.getByRole("region", { name: "Active incidents" });
      const maintenance = page.getByRole("region", { name: "Maintenance" });
      const top = async (locator: Locator) =>
        (await locator.boundingBox())?.y ?? Number.NaN;
      const incidentTop = await top(incidents);
      const maintenanceTop = await top(maintenance);
      const liveTop = await top(live);
      expect(incidentTop).toBeLessThan(maintenanceTop);
      expect(maintenanceTop).toBeLessThan(liveTop);

      alerts = { down: [], degraded: ["Images"] };
      await page.reload();
      await expect(
        live.getByRole("heading", { name: "Some services are degraded" }),
      ).toBeVisible();
      await expect(
        live.getByRole("heading", { name: "Some services are down" }),
      ).toHaveCount(0);
      await expect(live.getByText("Images", { exact: true })).toBeVisible();

      alerts = { down: ["Search"], degraded: [] };
      await page.reload();
      await expect(live.getByRole("heading", { level: 3 })).toHaveText([
        "Some services are down",
      ]);

      alerts = { down: [], degraded: [] };
      await page.reload();
      await expect(page.getByText(`Quiet ${stamp}`).first()).toBeVisible();
      await expect(live).toHaveCount(0);
      // The overall did not move with the notices.
      await expect(page.getByText("Some systems are down")).toHaveCount(1);
    } finally {
      await removeMonitor(page, id);
    }
  });
});

test("explains an unsupported degraded JSON path and saves a supported one", async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now().toString(36);
  const id = await createHttp(page, `Form ${stamp}`, `form-${stamp}`, true);
  try {
    await page.goto(`/console/monitors/${id}`);
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit monitor" }),
    ).toBeVisible();
    const path = page.locator('input[name="degradedJsonPath"]');
    await path.fill("status");
    await page.locator('input[name="degradedJsonExpect"]').fill("degraded");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(
        "Use a supported JSON path, such as $.status or $.items[0].ok.",
      ),
    ).toBeVisible();
    await expect(path).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/edit/);
    const unsaved = await page.request.get(`/api/monitors/${id}`);
    expect(
      ((await unsaved.json()) as { config: { degraded?: unknown } }).config
        .degraded,
    ).toBeUndefined();

    await path.fill("$.status");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).not.toHaveURL(/\/edit/);
    await expect(
      page.getByText(
        "Saved. This page shows the configuration the scheduler is using.",
      ),
    ).toBeVisible();
    const saved = await page.request.get(`/api/monitors/${id}`);
    expect(
      ((await saved.json()) as { config: { degraded?: unknown } }).config
        .degraded,
    ).toEqual({
      jsonPath: "$.status",
      jsonExpect: "degraded",
      keywordMode: "present",
      notify: true,
    });
  } finally {
    await removeMonitor(page, id);
  }
});

// Only the keyword is set, so the summary leaves the other conditions out.
test("summarizes only the degraded conditions that are set", async ({
  page,
}) => {
  await signIn(page);
  const stamp = Date.now().toString(36);
  const created = await page.request.post("/api/monitors", {
    headers,
    data: {
      name: `Summary ${stamp}`,
      type: "http",
      config: {
        url: `https://summary-${stamp}.invalid/health`,
        degraded: { keyword: "slow", notify: false },
      },
      intervalSeconds: 60,
      timeoutSeconds: 5,
      retries: 1,
      recoveryThreshold: 1,
      channelIds: [],
      paused: true,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = ((await created.json()) as { id: string }).id;
  try {
    await page.goto(`/console/monitors/${id}`);
    await expect(
      page.getByRole("heading", { name: `Summary ${stamp}` }),
    ).toBeVisible();
    await expect(
      page.getByText('body includes "slow" · alerts off', { exact: true }),
    ).toBeVisible({ timeout: 4_000 });
  } finally {
    await removeMonitor(page, id);
  }
});

// The "Degraded when" row lists only the conditions that are set. Other
// detail rows keep "Not set" for an empty value.
test.describe("degraded summary on the monitor detail page", () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    [
      "keyword absent",
      { keyword: "ready", keywordMode: "absent" },
      'body lacks "ready" · alerts on',
    ],
    [
      "JSON value",
      { jsonPath: "$.status", jsonExpect: "degraded" },
      "$.status = degraded · alerts on",
    ],
    [
      "response time",
      { maxResponseMs: 1500 },
      "slower than 1500 ms · alerts on",
    ],
    [
      "all three",
      {
        keyword: "slow",
        jsonPath: "$.status",
        jsonExpect: "degraded",
        maxResponseMs: 1500,
        notify: false,
      },
      'body includes "slow" · $.status = degraded · slower than 1500 ms · alerts off',
    ],
    ["no conditions", null, "Not set"],
  ];

  for (const [label, degraded, summary] of cases) {
    test(`summarizes ${label}`, async ({ page }) => {
      await signIn(page);
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const created = await page.request.post("/api/monitors", {
        headers,
        data: {
          name: `Summary ${stamp}`,
          type: "http",
          config: {
            url: `https://summary-${stamp}.invalid/health`,
            ...(degraded ? { degraded } : {}),
          },
          intervalSeconds: 60,
          timeoutSeconds: 5,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
          paused: true,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const id = ((await created.json()) as { id: string }).id;
      try {
        await page.goto(`/console/monitors/${id}`);
        await expect(
          page.getByRole("heading", { name: `Summary ${stamp}` }),
        ).toBeVisible();
        const row = (label: string) =>
          page.locator(`dt:text-is("${label}") + dd`);
        await expect(row("Degraded when")).toHaveText(summary);
        // The health checks are not set on these monitors.
        await expect(row("Keyword")).toHaveText("Not set");
        await expect(row("JSON path")).toHaveText("Not set");
        await expect(row("Expected JSON value")).toHaveText("Not set");
      } finally {
        await removeMonitor(page, id);
      }
    });
  }
});

// A blank expected value matches a blank string, so the summary quotes it.
// textContent keeps the spaces that toHaveText would collapse.
test.describe("blank expected JSON value in the degraded summary", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    [
      "an empty value",
      { jsonPath: "$.status", jsonExpect: "" },
      '$.status = "" · alerts on',
    ],
    [
      "a whitespace-only value",
      { jsonPath: "$.status", jsonExpect: "  " },
      '$.status = "  " · alerts on',
    ],
    [
      "a value with letters and spaces",
      { jsonPath: "$.status", jsonExpect: " ok " },
      "$.status =  ok  · alerts on",
    ],
    ["an empty keyword", { keyword: "" }, "Not set"],
  ];

  for (const [label, degraded, summary] of cases) {
    test(`summarizes ${label}`, async ({ page }) => {
      await signIn(page);
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const created = await page.request.post("/api/monitors", {
        headers,
        data: {
          name: `Blank ${stamp}`,
          type: "http",
          config: { url: `https://blank-${stamp}.invalid/health`, degraded },
          intervalSeconds: 60,
          timeoutSeconds: 5,
          retries: 1,
          recoveryThreshold: 1,
          channelIds: [],
          paused: true,
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const id = ((await created.json()) as { id: string }).id;
      try {
        await page.goto(`/console/monitors/${id}`);
        await expect(
          page.getByRole("heading", { name: `Blank ${stamp}` }),
        ).toBeVisible();
        const row = (name: string) =>
          page.locator(`dt:text-is("${name}") + dd`);
        await expect(row("Degraded when")).toHaveText(
          summary.replace(/\s+/g, " "),
        );
        expect(await row("Degraded when").textContent()).toBe(summary);
        await expect(row("Expected JSON value")).toHaveText("Not set");
      } finally {
        await removeMonitor(page, id);
      }
    });
  }
});
