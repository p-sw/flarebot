import { env } from "cloudflare:test";
import { createApp } from "../worker/app";

const app = createApp();
export const origin = "https://flarebot.test";

export async function api(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (cookie) headers.set("cookie", `flarebot_session=${cookie}`);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return app.request(`${origin}${path}`, { ...init, headers }, env);
}

export function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = /flarebot_session=([^;]+)/.exec(raw);
  if (!match?.[1]) throw new Error(`missing session cookie: ${raw}`);
  return match[1];
}

export async function ownerSession(): Promise<string> {
  const meta = (await (await api("/api/meta")).json()) as {
    setupRequired: boolean;
  };
  if (meta.setupRequired) {
    const setup = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupSecret: "test-setup-secret",
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
      }),
    });
    if (setup.status !== 201)
      throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
    return cookieFrom(setup);
  }
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ada@example.com",
      password: "correct-horse",
    }),
  });
  if (login.status !== 200)
    throw new Error(`login failed: ${login.status} ${await login.text()}`);
  return cookieFrom(login);
}
