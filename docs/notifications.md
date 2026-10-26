# Notifications

Flarebot sends a message when a monitor is confirmed down, when it recovers, and once when it flaps. The same copy is used for every channel: `notify_down_subject`, `notify_up_subject`, `notify_unstable_subject`, and the matching body strings in `brand/locale.json`. A down message includes the check reason. Recovery and flapping messages name the monitor.

Channels are rows in `notification_channels`. The config is a JSON object encrypted with `ENCRYPTION_KEY` before it is stored. The list API decrypts it for someone who can edit channels, then blanks secret fields and returns a `secrets` array so the form can say a value is already saved. A blank secret on update keeps the stored value. `clearSecrets` removes an optional secret (the ntfy access token, or webhook header values). Viewers see the name, type, and a non-secret destination such as a hostname or room id.

Creating or editing a channel checks the config with `shared/channels.ts`. URLs must be public `http` or `https`. Private and local hosts use the same rules as HTTP monitors. Send test and a real alert both refuse those addresses, so a saved row cannot be aimed at loopback later.

## Channel types

| Type            | What you set                                             | What is secret                                                        |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Email           | Recipient                                                | Nothing in the channel row. Delivery uses the instance mail settings. |
| Discord         | Webhook URL                                              | The URL                                                               |
| Slack           | Webhook URL                                              | The URL                                                               |
| Telegram        | Bot token and chat id                                    | Bot token                                                             |
| Webhook         | URL and up to 10 headers                                 | URL and header values                                                 |
| ntfy            | Server URL, topic, optional access token, priority, tags | Access token                                                          |
| Gotify          | Server URL, app token, optional priority                 | App token                                                             |
| Pushover        | User key, app token, optional device, priority, sound    | User key and app token                                                |
| Microsoft Teams | Incoming webhook or Workflows webhook URL                | The URL                                                               |
| Google Chat     | Incoming webhook URL                                     | The URL                                                               |
| Matrix          | Homeserver URL, access token, room id or alias           | Access token                                                          |

ntfy publishes JSON to the server base URL (`topic`, `title`, `message`, `priority`, `tags`). With no priority, down is 5, flapping is 4, and recovery is 3. With no tags, those alerts use `rotating_light`, `warning`, and `white_check_mark`. Gotify posts to `{server}/message` with the `X-Gotify-Key` header. With no priority, down is 8, flapping is 5, and recovery is 2.

Pushover posts to `https://api.pushover.net/1/messages.json`. With no priority, down is high (1) and recovery or flapping is normal (0). Priority 2 is emergency: Flarebot also sends `retry` 60 and `expire` 3600, so Pushover repeats the alert every minute for one hour.

Teams sends an Adaptive Card (`application/vnd.microsoft.card.adaptive`, version 1.4) wrapped the way a Workflows "When a Teams webhook request is received" trigger expects. The title color is red for down, yellow for flapping, and green for recovery. Google Chat sends a `cardsV2` card plus a plain-text preview. Matrix sends `m.room.message` with `msgtype` `m.text` as `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` and a bearer token. The account that owns the token must already be in the room.

A generic webhook receives:

```json
{
  "event": "down",
  "monitor": "API",
  "reason": "timeout",
  "text": "API is down. Reason: timeout"
}
```

`event` is `down`, `up`, or `unstable`.

## Send test

Send test on a channel uses the saved config. Email goes through `deliverWith` and reports the mail stage. Every other type calls the remote service once, formatted as a down alert whose reason is "test". A non-2xx response or a network error is returned to the button. The response body is not shown.

## Delivery and the free plan

Confirming a state change notifies that monitor's channels inside the scheduler invocation. Each non-email channel is one `fetch`. There is no extra retry loop on that path: a retry would multiply subrequests, and a free-plan invocation allows 50. Email is the exception. It is written to `mail_outbox` and the mailer retries on the existing schedule (1 minute, 5 minutes, 30 minutes, 2 hours).

A monitor can attach up to 20 channels. Those requests sit beside the check that just finished, so a monitor with many channels spends more of the 50-subrequest budget on the invocation that pages you. No new cron, table, or migration is required. Config stays in the encrypted column that already exists.

Incident and maintenance announcements use this same transport when their notify switch is on. They are queued and sent from the five-minute cron, at most eight rows a run. See [announcements.md](announcements.md). The same 50-subrequest budget, and what Workers Paid changes, is in the README under [Workers Paid plan](../README.md#workers-paid-plan).

The console lists channels with a search once there are more than six, and the add form has a searchable type picker. The monitor form uses the same search when it attaches channels.
