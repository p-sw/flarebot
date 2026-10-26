// SPDX-License-Identifier: MIT

import { Hono } from "hono";
import { t } from "../shared/copy";
import { registerFrontDoor } from "./front-door";
import { ApiError, type AppEnv } from "./http";
import { registerAuth } from "./routes/auth";
import { registerBadges } from "./routes/badges";
import { registerIncidents } from "./routes/incidents";
import { registerMaintenance } from "./routes/maintenance";
import { registerManage } from "./routes/manage";
import { registerMonitors } from "./routes/monitors";
import { registerScreenshotSeed } from "./routes/screenshot-seed";
import { registerSso } from "./routes/sso";
import { registerSubscriptions } from "./routes/subscriptions";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "private, no-store");
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    console.error(error);
    return c.json(
      { error: { code: "internal", message: t("error_internal") } },
      500,
    );
  });
  registerAuth(app);
  registerSso(app);
  registerMonitors(app);
  registerBadges(app);
  registerIncidents(app);
  registerMaintenance(app);
  registerManage(app);
  registerSubscriptions(app);
  registerScreenshotSeed(app);
  registerFrontDoor(app);
  app.all("/api/*", (c) =>
    c.json(
      { error: { code: "not_found", message: t("error_api_not_found") } },
      404,
    ),
  );
  app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
