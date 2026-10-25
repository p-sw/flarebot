// SPDX-License-Identifier: MIT

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
