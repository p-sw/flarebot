# Subscriptions

Visitors can follow a public status page by email, by webhook, or by an RSS or Atom feed. Delivery reads `announcement_events` and writes `subscription_deliveries`. It does not insert `announcement_outbox` rows; that table remains the channel queue. Incident and maintenance routes do not know about subscribers. Migration `0008_visitor_subscriptions.sql` is additive.

## What a visitor can do

Email and webhook forms are on the public page when that channel is enabled for the page. The form defaults to every component on the page. A visitor can clear that and pick components. Email is hidden when no mail driver can send. The status page editor explains that.

Email is double opt-in. The subscribe request writes a pending row and queues one confirmation message through the existing mail outbox. The message links to a confirmation page, a manage page, and an unsubscribe page. Opening the confirmation link marks the row confirmed. Every later message includes an unsubscribe link. The message also sets `List-Unsubscribe` and `List-Unsubscribe-Post` so a mailbox can unsubscribe with one POST. The manage page changes which components are followed.

Webhook subscribe checks the URL, then POSTs a signed verification ping. The signing secret is returned once. Later events use the same HMAC: `X-Flarebot-Signature` is `sha256=` plus the hex HMAC-SHA256 of `{timestamp}.{raw body}`, and `X-Flarebot-Timestamp` is the unix time. URLs are encrypted at rest. Redirects are not followed. Private, loopback, and link-local hosts are rejected, including names that resolve to those addresses. Plain HTTP is rejected unless Settings allows it.

RSS and Atom feeds list recent incident and maintenance events for that page. Responses are cached for 60 seconds. The public HTML advertises both feeds when the channel is on.

## Tokens

Confirmation, manage, and unsubscribe tokens are random. The database stores only their SHA-256 hashes, in `subscription_tokens`. A new message adds new manage and unsubscribe hashes and leaves the previous ones valid until history retention deletes them, so an older email can still unsubscribe. Webhook signing secrets and URLs are encrypted with `ENCRYPTION_KEY`. They are not hashes, because the worker has to sign the next request.

## Spam controls

When a Turnstile site key and secret are saved in Settings, or both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set and Settings has no pair of its own, the subscribe form requires a Turnstile token. Sign-in still uses only the Worker secrets. When neither source is configured, the form says it is using rate limits.

Limits, per status page:

| Limit | Value |
| --- | --- |
| Attempts per IP per hour | 8 |
| Attempts per email or webhook address per hour | 4 |
| Pending unconfirmed email rows | 100 |

Pending rows expire after 48 hours. Retention then deletes those expired pending rows. It does not delete confirmed or disabled subscribers.

## Console

An Admin or Owner turns email, webhook, and RSS on per status page. The same screen lists subscribers, filters by status, searches email addresses, removes a row, and exports CSV. Counts show pending, confirmed, and disabled. The waiting-to-send number is the delivery backlog. Toggle changes, removals, and the Settings fields write audit log rows. The Turnstile secret is not written to the audit log.

A webhook that fails five deliveries is disabled. The row stays so it can be removed or replaced.

## Free plan

The Worker cron stays `*/5 * * * *` (288 runs per day). Each run already drains at most 8 announcement-channel sends. Subscriptions add:

| Step | Per run | Per day at the cap | Subrequests |
| --- | --- | --- | --- |
| Fan-out into `subscription_deliveries` | 12 rows | n/a | 0 |
| Drain | 6 deliveries | 1,728 | 1 fetch per webhook, plus one Mailer kick if any email was queued |

1,728 is the most subscribers a single event can finish in one day, and only when that event is the only thing draining. Several incidents share the six sends. A longer list stays queued; the console shows the backlog; the next runs continue it.

D1 writes for a full day at that cap are about 3,456 (one insert and one update per delivery), inside the 100,000 writes/day. Confirmation mail is one outbox row on the subscribe request, not on the cron. DNS checks for a new webhook also run on that request.

The batches stay small so the 10ms CPU limit and the 50-subrequest limit still have room for shard alarms and the announcement drain (8). Worst case for this feature on the cron is 6 webhook fetches plus 1 Mailer kick.

## Retention

History retention also deletes sent and failed delivery rows, expired pending subscribers, and subscription tokens older than the window. Confirmed and disabled subscribers stay until someone removes them or they unsubscribe. Active subscribers are not deleted by retention.
