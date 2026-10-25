// SPDX-License-Identifier: MIT

import { Hono } from "hono";
import { registerFrontDoor } from "./front-door";
import { ApiError, type AppEnv } from "./http";
import { registerAuth } from "./routes/auth";
import { registerManage } from "./routes/manage";
import { registerMonitors } from "./routes/monitors";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    console.error(error);
    return c.json(
      { error: { code: "internal", message: "Something went wrong." } },
      500,
    );
  });
  registerAuth(app);
  registerMonitors(app);
  registerManage(app);
  registerFrontDoor(app);
  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: "Not found." } }, 404),
  );
  app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
