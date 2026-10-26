# Development

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

The dev server is http://127.0.0.1:5173. Create the owner at `/setup`, sign in at `/login`, and use the admin UI at `/console`.

## Scheduler and daily rollups

`SchedulerShard` keeps the open hour in memory. An alarm runs at most 12 checks. About every five minutes, and when the hour changes, the shard flushes that hour to `uptime_hourly` and writes `monitor_state`. The flush is three D1 statements however many monitors are on the shard: one maintenance read, one `batch()` of the hourly reads, and one `batch()` of the upserts. `db.batch()` counts as a single query against D1's 50-queries-per-invocation cap ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). Rows read and rows written are still counted per row, including one extra write when a statement touches a secondary index ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). Batching does not shrink those daily quotas, so the flush stays the existing per-monitor upserts and the daily rollup does not.

The Worker cron is `*/5 * * * *` (`worker/scheduler/watchdog.ts`), 288 runs per day. It repairs a missing alarm, rolls daily totals, prunes history, and drains mail, announcements, and visitor subscriptions. The same invocation stops at 40 D1 statements. Prune, maintenance signals, and the outbox drains check the remaining budget and leave unfinished rows for the next run instead of failing.

### Check region

`settings.check_region` is the global placement. A missing row means `auto`: `schedulerStub` does not pass `locationHint`. The existing shard `shard-0` is that automatic shard, so a deploy that does not change Settings leaves every monitor where it is. `monitors.regions_json` is the per-monitor choice. `["default"]` means inherit (the value already stored on every row). Any other single entry is `auto` or a [Durable Object location hint](https://developers.cloudflare.com/durable-objects/reference/data-location/): `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr`, `me`. There is no migration.

Other shards are named `<region>-<n>`. `get()` receives `{ locationHint }` only for those names, and only the first `get()` for a name is honored. Capacity is still `floor(6 * interval / timeout)`, counted inside one region. A move detaches the monitor from the old shard first (so two shards never check it), flushes the open hour and 15-minute slot, upserts the snapshot on the new shard, and only then updates `shard_id`. A crash retries on the next cron. The in-memory recent-results buffer is not copied; the chart on the new shard starts empty. Status, confirmations, open incidents, and D1 history stay. An empty shard deletes its alarm.

The cron moves at most 4 monitors per run (2 statements to scan, 3 per move, 14 at most) and then calls `ensureAlarm` on shards that still have rows. Durable Object requests and duration follow the checks, not the number of regions in the list. Unused regions are not created and are not woken.

Choose a region close to the monitored hosts and to the people reading the status page. `apac-ne` is the northeast of Asia-Pacific (Korea, Japan, and nearby). Hints are a best effort. South America, Africa, and the Middle East are placed in the nearest location that runs Durable Objects. To move an existing installation, deploy this release, leave Settings on Automatic until you are ready, then set Check region to the hint you want. The first batch moves in that request. The five-minute cron finishes the rest.

HTTP checks record response time (TTFB). The timer stops when the response headers arrive, including DNS, TCP, TLS, and redirects. The body, still capped at 64 KB, is read only when the check has a keyword or JSON assertion. Otherwise the body is cancelled so the connection is released. TCP, DNS, certificate, and heartbeat timing are unchanged.

`uptime_daily` is the sum of that UTC day's `uptime_hourly` rows: ok, fail, latency sum, max latency, and maintenance count. The open UTC day is not written, which is the same rule as the previous rollup. `rollup_dirty` records a monitor day when an hourly row is upserted. The cron rewrites at most two such closed days per run, with one `INSERT INTO uptime_daily ... SELECT ... GROUP BY`. After midnight the day that just closed is dirty, so the next cron writes it. A flush that lands after that cron marks yesterday again, and the following cron rewrites it. Unchanged days are not read and not written, so retention length drops out of the per-run cost.

`rollup_watermark.pending_before` walks days that already exist, newest closed day first, one day per cron. `0` means the walk has not started. A positive value is the exclusive upper bound of hours still to revisit. `-1` means the walk is finished. Each step rewrites that day from its hourly rows, so a daily row the old loop never finished becomes the same totals. The migration does not update existing rollup rows. The walk is one-time: after `-1`, only dirty days are rewritten.

Let `N` be monitors, `R` be retained days, `C` be 288 cron runs per day, and `H` be hourly rows per monitor on a closed day (at most 24).

| Work                                    | Statements per invocation                 | Rows, steady state                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily rollup, nothing dirty             | 2 (watermark, dirty scan)                 | Reads about `C * (1 + N)` per day from the watermark row and the dirty table. No daily writes                                                                                                                                            |
| Daily rollup, a closed day is dirty     | 4                                         | Reads `N * H` hourly rows on that run, once or twice a day. Writes `N` daily rows (plus the `day_start` index row, so about `2N` metered writes)                                                                                         |
| One-time backfill step                  | 7 on the first step, 6 after that         | The first step also marks today. Each step reads one hour to find the day, then `N * H` hourly rows, and writes `N` daily rows. At most `R` runs, then it stops                                                                          |
| Whole cron, prune running, drains empty | At most 40, and the code defers past that | Prune adds its existing capped deletes. Drains add only the rows they still have budget to send                                                                                                                                          |
| Shard flush of `M` monitors             | 3                                         | Same row writes as before: about one hourly upsert and one `monitor_state` upsert per monitor that had samples, about 288 times a day, plus the 15-minute slot writes. A dirty mark is one insert per monitor per UTC day, not per flush |

The previous rollup was about `1 + N * R` statements per cron and about `N * R * C` daily-row writes per day. Those no longer depend on `R`. A Free deployment's rollup cost grows with `N`, not with how long history is kept.

Migration `0009_rollup_incremental.sql` adds `rollup_dirty` and `rollup_watermark` only.

Useful scripts:

| Script                  | What it does                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Generates Worker types, then typechecks the client and the Worker                                                                                              |
| `pnpm test`             | Vitest in Node, then Vitest on the Workers pool with local D1                                                                                                  |
| `pnpm test:worker`      | API, scheduler, and SMTP-stage tests                                                                                                                           |
| `pnpm test:e2e`         | Chromium smoke tests against `vite preview` (build, then port 4173). Seeds the owner once, then runs the specs in parallel. Brand screenshots are not included |
| `pnpm test:coverage`    | Unit and Worker coverage summaries                                                                                                                             |
| `pnpm brand:preview`    | Playwright screenshots of the dashboard for a rebrand. Not part of `pnpm test:e2e`                                                                             |
| `pnpm screenshots`      | Rebuilds `docs/images/dashboard.webp` and `docs/images/status.webp` from a local demo database. Not part of CI. It never reads production data                 |
| `pnpm copy:check`       | Every `t()` and `copy()` key exists in `brand/locale.json`, and UI files do not hardcode new sentences                                                         |
| `pnpm lint:lang`        | Rejects non-Latin text outside `brand/locale.json`                                                                                                             |
| `pnpm brand:check`      | Scope gate, contrast, typecheck, unit tests                                                                                                                    |
| `pnpm db:migrate:local` | Applies `migrations/` to local D1                                                                                                                              |

Hooks are Lefthook (`pnpm install` runs `lefthook install`). Pre-commit formats the staged files, checks language, and typechecks. Pre-push runs the Vitest suites, `copy:check`, and the production build. Playwright stays out of that hook so a push stays on the fast path; run `pnpm test:e2e` when you change the UI. Commit messages follow Conventional Commits. If `core.hooksPath` points somewhere else, Lefthook still needs an executable `pre-commit`, `commit-msg`, and `pre-push` in `.git/hooks` so that dispatcher can chain to them.

Worker tests import the Hono app and the `cloudflare:test` env. They do not import `worker-mailer` from a Node test, because that package loads `cloudflare:sockets`. Single sign-on is covered by `shared/sso.test.ts`, `worker/auth/jwt.test.ts`, and `test/sso.worker.test.ts`. Those tests sign tokens locally and do not call a real provider.

`worker-configuration.d.ts` is gitignored. CI regenerates it. Copy is read from `brand/locale.json` with no compile step.

GitHub Actions runs lint, typecheck, tests, the production build, and Playwright in parallel. A new push to a pull request cancels the in-progress run. `pnpm build` removes `.dev.vars` from `dist/` and fails if secret values remain in the Worker output or the client assets. Playwright copies that file back into `dist/flarebot/` only to boot `vite preview`. It then applies local D1 migrations into `.wrangler/e2e`. That directory is separate from `pnpm dev`, so the two servers can run at once. `pnpm dev` is for local editing; it is not the CI browser target. `pnpm screenshots` boots preview on port 4174 with `FLAREBOT_PERSIST=.wrangler/screenshots`, creates a local demo account and monitors, and writes `docs/images/dashboard.webp` and `docs/images/status.webp`. It does not call a remote database. For that process only, `scripts/screenshot-preview.mjs` sets `FLAREBOT_SCREENSHOTS=1` in `.dev.vars` and copies it to `dist/flarebot/.dev.vars`, which `vite preview` reads. The line is removed when the preview exits, and it is not part of a deploy.
