# Architecture

The Worker is a Hono app (`worker/app.ts`) plus two Durable Objects.

`SchedulerShard` holds monitor snapshots, the last 60 results, and the current hour's rollup. An alarm runs at most 12 checks with 6 concurrent connections so a free-plan invocation stays inside the subrequest and connection limits. A shard's capacity is `floor(6 * interval / timeout)` monitors; 60 second checks with a 10 second timeout fit 36 monitors. Extra due checks get a follow-up alarm. The cron trigger every five minutes calls `ensureAlarm` if an alarm was lost. The same run rolls daily totals and prunes check history. Pruning runs at most once an hour, or every five minutes while a batch comes back full, and stops after 20,000 deletes in a UTC day.

The first failure sets the monitor to `pending` and retries in 10 seconds. After `retries` failures (default 2) the monitor is `down`, an outage row opens, and channels are notified. `recoveryThreshold` successes (default 1) close the outage. Internal errors (a CT log timeout, for example) become `unknown` and do not alert. Three state changes in 30 minutes send one "unstable" alert and then suppress further alerts until the monitor settles.

Pausing a monitor sets `monitors.paused` and the runtime status to `paused`, and the shard skips it until resume. Resume sets the runtime to `pending` and schedules the next check immediately, so the badge reads "Checking" until that result. Public status items use the same rule. When every monitor on a page is paused, the hero says "All monitors are paused" instead of "All systems operational". Authenticated and public JSON under `/api/*` is `private, no-store`.

D1 stores configuration, incidents, and hourly/daily rollups. Analytics Engine receives one point per check. The dashboard reads D1 plus the shard memory, so it works without the account-level Analytics Engine SQL API. Rollups flush about every five minutes and when the state changes.

Authorization is `can(actor, action, resource)` in `shared/permissions.ts`. The resource argument is ignored in this version. API tokens are stored as SHA-256 hashes. At use time their scopes are intersected with the creator's current role. Viewers can mint only the `read` scope.

Each status page stores `display_range` (`24h`, `7d`, `30d`, or `90d`). Existing rows default to `24h`. The public page renders that window: one bar per hour for 24 hours, and one bar per UTC day otherwise. Uptime and average response time use the same buckets. Daily bars for past days come from `uptime_daily`. Today adds `uptime_hourly` and the shard's unflushed hour, and does not also add a daily row. If Settings keeps fewer days than the page asks for, the page shows the shorter window and says so. A one-day retention falls back to the 24 hour chart.

Public badges live at `/badge/:id/status.svg`, `/badge/:id/uptime.svg`, and `/badge/:id/response.svg`. A monitor is included when `badges_enabled` is set or it appears on a published status page. Every other id returns the same unknown badge with `200`, `Cache-Control: public, max-age=120`, and an `ETag`. The Worker stores that response in the Cache API. Uptime and response time reuse the status-page window, shortened to the history retention setting. Details and free-plan costs are in [badges.md](badges.md). Migration `0004_monitor_badges.sql` adds `monitors.badges_enabled` (default `0`) and an index on `status_page_items.monitor_id`.

Status page text is the stored title, description, footer, banner, group name, and display name. A monitor is labeled with its display name when that field is set, and otherwise with the monitor's own name. Section headings come from the item group name. Item `position` is the order inside the page: sections follow the first item of each group, and monitors follow their positions inside that group. Creating or replacing a page writes the page row and its items in one D1 batch, so a failed item does not leave a page behind. The public page ignores `Accept-Language`, the `locale` cookie, and `?lang=`. The public JSON does not include target URLs. `GET /s/:slug` injects `lang` from `brand/locale.json`, plus title, description, and canonical, into the SPA shell. It does not emit `hreflang` or `Vary: Accept-Language`. Responses that choose a page, including `/`, use `Cache-Control: private, no-store` so a shared cache cannot pin the wrong document.

These D1 columns are deprecated and unused. They stay so existing production rows, including a status page named `monit` and users that already have a `locale` value, keep working. Migrations do not drop them. New status-page inserts still fill the `NOT NULL` ones with the locale file's `lang` and an empty translation map. Replacing a page does not rewrite those columns on the page row. New items still fill their `NOT NULL` locale columns the same way.

| Column                                                         | Table                            |
| -------------------------------------------------------------- | -------------------------------- |
| `locale`                                                       | `users`, `notification_channels` |
| `default_locale`, `locales_json`, `source_locale`, `i18n_json` | `status_pages`                   |
| `source_locale`, `i18n_json`                                   | `status_page_items`              |

## URLs

| Path                                                                                             | What it serves                                                                    |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `/`                                                                                              | The one published status page with `serve_at_root`, or a redirect to `/login`     |
| `/s/:slug`                                                                                       | That status page. The slug keeps working when the page is also the root           |
| `/login`                                                                                         | Sign-in. An existing session redirects to `/console`                              |
| `/console` and `/console/*`                                                                      | Admin app. Signed-out requests redirect to `/login?next=` with a same-origin path |
| `/console/status-pages/new` and `/console/status-pages/:id`                                      | Create a status page, or edit its text, branding, and monitor layout              |
| `/setup`                                                                                         | First-run wizard. Once an owner exists, this redirects to `/login`                |
| `/forgot`, `/reset/:token`, `/invite/:token`                                                     | Account recovery and invites                                                      |
| `/api/*`, `/push/*`                                                                              | API and heartbeat ingest, unchanged                                               |
| `/badge/:id/status.svg`, `/badge/:id/uptime.svg`, `/badge/:id/response.svg`                      | Public SVG badges. See [badges.md](badges.md)                                     |
| `/monitors`, `/status-pages`, `/channels`, `/team`, `/tokens`, `/audit`, `/settings`, `/account` | Redirect to the same path under `/console`                                        |

The Worker handles those HTML routes before the asset SPA fallback, so the browser does not paint the admin shell for a public page or the public page for an admin URL. Only one `status_pages.serve_at_root` value can be `1`. The API clears the previous row in the same D1 batch that sets the new one.

Maintenance windows and multi-region checks are extension points. `isInMaintenance` returns false. Only `regions[0]` is executed.
