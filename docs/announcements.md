# Announcements

Incidents and maintenance windows publish a small event. Channel delivery and a later visitor subscription (email, webhook, or RSS) both hang off this event. They do not reach into the incident or maintenance tables.

## Event

`AnnouncementEvent` in `shared/announcements.ts`:

| Field            | Meaning                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`           | `incident.created`, `incident.updated`, `incident.resolved`, `maintenance.scheduled`, `maintenance.started`, `maintenance.completed` |
| `organizationId` | Owning organization                                                                                                                  |
| `subjectType`    | `incident` or `maintenance`                                                                                                          |
| `subjectId`      | Row id                                                                                                                               |
| `title`          | Short title                                                                                                                          |
| `summary`        | Plain text. Markdown is not rendered here                                                                                            |
| `occurredAt`     | When the event happened, in milliseconds                                                                                             |
| `href`           | Public path, or `null` when no status page is linked                                                                                 |

`incident.updated` covers title, impact, pages, and timeline edits, including a reopen. `incident.resolved` is only the transition to Resolved.

`maintenance.scheduled` is sent when a window is created or its schedule changes and the next run is still in the future. `maintenance.started` and `maintenance.completed` are sent when an occurrence begins or ends.

## Publishing

```ts
await publishAnnouncement(env.DB, event, channelIds);
```

`worker/announce/publish.ts` writes one `announcement_events` row and, for each channel id, one `announcement_outbox` row. Pass an empty channel list to record the event without paging anyone. At most 20 channels are queued per event.

Do not POST to a channel inside the request that created the incident. The five-minute cron calls `drainAnnouncements`, which sends at most 8 outbox rows. Each row is one subrequest (or one mail-outbox insert for email). A failed row is retried up to three times, five minutes apart. That stays inside the Workers free plan: the cron already exists, and 8 subrequests leave room in the 50-subrequest budget.

`deliverAnnouncement` calls the same transport as a monitor alert (`deliverPrepared` in `worker/notify/dispatch.ts`). Email, Discord, Slack, Telegram, webhook, ntfy, Gotify, Pushover, Microsoft Teams, Google Chat, and Matrix all accept an incident or a maintenance window. A created incident uses the down priority and color. A resolved incident or a completed window uses the recovery level. Updates, a scheduled window, and a started window use the flapping level. The generic webhook body is the announcement JSON (`event`, `title`, `summary`, `href`, `occurredAt`, `subjectType`, `subjectId`, `text`), not the monitor alert body. Private and local URLs are refused the same way as a monitor alert.

## Maintenance signals

`emitMaintenanceSignals` runs on the same cron. It looks back six hours and writes at most 8 new start or completed events. The rest wait for the next run. A signal row stops the same occurrence from being announced twice. Creating a window that is already active writes the started signal immediately so the cron does not send it again.

Channel ids are attached to start and completed events only when the window's notify switch is on.

## Subscriptions

A follow-up can add a sink in one of two ways:

1. Read `announcement_events` (ordered by `created_at`) and deliver to subscribers on the same cron, with its own batch cap.
2. Wrap `publishAnnouncement` and insert subscriber deliveries beside the channel outbox.

Do not add subscription branching to the incident or maintenance routes. The public status JSON already includes active incidents, incident history, and maintenance. This change does not add an RSS or Atom feed.

## Retention

History retention, the same setting that drops old check buckets and finished automatic outages, also drops:

- incidents whose `resolved_at` is older than the window (open incidents stay)
- one-time maintenance whose end is older than the window
- cancelled maintenance whose `cancelled_at` is older than the window
- announcement events older than the window

A repeating window that is not cancelled stays, because it still has future occurrences. The audit log is not pruned. Samples that were counted as maintenance stay in `maint_count` until the hourly or daily bucket itself ages out.
