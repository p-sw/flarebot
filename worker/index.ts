// SPDX-License-Identifier: AGPL-3.0-only

import { createApp } from "./app";
import { Mailer } from "./mail/mailer";
import { SchedulerShard } from "./scheduler/shard";
import { watchdog } from "./scheduler/watchdog";

export { Mailer, SchedulerShard };

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(watchdog(env));
  },
} satisfies ExportedHandler<Env>;
