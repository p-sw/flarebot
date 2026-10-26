// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../worker/app";

const app = createApp();

describe("screenshot seed route", () => {
  it("stays hidden unless the local screenshot flag is set", async () => {
    expect(env.FLAREBOT_SCREENSHOTS).toBeUndefined();
    const response = await app.request(
      "https://flarebot.test/api/dev/screenshot-history",
      {
        method: "POST",
        headers: {
          origin: "https://flarebot.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ monitors: [] }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "We could not find that." },
    });
  });

  it("registers when the local screenshot flag is set", async () => {
    const response = await app.request(
      "https://flarebot.test/api/dev/screenshot-history",
      {
        method: "POST",
        headers: {
          origin: "https://flarebot.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ monitors: [] }),
      },
      { ...env, FLAREBOT_SCREENSHOTS: "1" },
    );
    expect(response.status).toBe(401);
  });
});
