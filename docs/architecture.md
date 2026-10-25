# Architecture

The Worker is a Hono app (`worker/app.ts`) plus two Durable Objects.

`SchedulerShard` holds monitor snapshots, the last 60 results, and the current hour's rollup. An alarm runs at most 12 checks with 6 concurrent connections so a free-plan invocation stays inside the subrequest and connection limits. A shard's capacity is `floor(6 * interval / timeout)` monitors; 60 second checks with a 10 second timeout fit 36 monitors. Extra due checks get a follow-up alarm. The cron trigger every five minutes only calls `ensureAlarm` if an alarm was lost.

The first failure sets the monitor to `pending` and retries in 10 seconds. After `retries` failures (default 2) the monitor is `down`, an outage row opens, and channels are notified. `recoveryThreshold` successes (default 1) close the outage. Internal errors (a CT log timeout, for example) become `unknown` and do not alert. Three state changes in 30 minutes send one "unstable" alert and then suppress further alerts until the monitor settles.

D1 stores configuration, incidents, and hourly/daily rollups. Analytics Engine receives one point per check. The dashboard reads D1 plus the shard memory, so it works without the account-level Analytics Engine SQL API. Rollups flush about every five minutes and when the state changes.

Authorization is `can(actor, action, resource)` in `shared/permissions.ts`. The resource argument is ignored in this version. API tokens are stored as SHA-256 hashes. At use time their scopes are intersected with the creator's current role. Viewers can mint only the `read` scope.

Status page text is per field: requested language, then the page default, then the source string. The public JSON does not include target URLs. `GET /s/:slug` injects `lang`, title, description, canonical, and `hreflang` into the SPA shell and sets `Vary: Accept-Language` when the language came from the header.

Maintenance windows and multi-region checks are extension points. `isInMaintenance` returns false. Only `regions[0]` is executed.
