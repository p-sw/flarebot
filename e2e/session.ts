import { expect, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:4173";
export const email = "owner@example.com";
export const password = "flarebot-pass";
export const setupSecret = "change-me-setup-secret";

const json = {
  origin,
  "content-type": "application/json",
};

export async function signIn(page: Page): Promise<void> {
  const login = await page.request.post("/api/auth/login", {
    headers: json,
    data: { email, password },
  });
  if (!login.ok()) {
    throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  }
  const cookie = /flarebot_session=([^;]+)/.exec(
    login.headers()["set-cookie"] ?? "",
  )?.[1];
  expect(cookie).toBeTruthy();
  await page.context().addCookies([
    {
      name: "flarebot_session",
      value: cookie ?? "",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function createHeartbeat(
  page: Page,
  name: string,
): Promise<string> {
  const created = await page.request.post("/api/monitors", {
    headers: json,
    data: {
      name,
      type: "heartbeat",
      config: { graceSeconds: 30 },
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
    },
  });
  if (!created.ok()) {
    throw new Error(
      `create monitor failed: ${created.status()} ${await created.text()}`,
    );
  }
  const body = (await created.json()) as { id: string };
  return body.id;
}
