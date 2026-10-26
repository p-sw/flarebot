---

name: add-notification-channel
description: Add a notification channel type to Flarebot. Use when implementing Discord-like delivery for a new service such as a webhook variant or a chat platform.
---

# Add a notification channel

Channel types live in `shared/channels.ts`. Delivery lives in `worker/notify/dispatch.ts`. The console form is `src/pages/channel-form.tsx` with the type list and icons in `src/pages/channel-catalog.tsx`. The list, delete, send-test, and monitor attach UI is `src/pages/channels.tsx`. Copy is `brand/locale.json`. Operator docs are `docs/notifications.md`.

Do not add a table or migration unless a value cannot live in the encrypted config JSON. `ENCRYPTION_KEY` already encrypts that JSON. Secret fields are listed in `channelSecretFields`. `redactChannelConfig` blanks them on `GET /api/channels`. `mergeChannelSecrets` keeps a stored secret when an update sends it blank, and `clearSecrets` drops an optional one. Do not return a raw token, webhook URL, or header value to the browser.

## Steps

1. Add the type to `channelTypeSchema` and a zod object in `configSchema`. Reject private URLs with `publicHttpUrl` (the same host rules as HTTP monitors) when the channel calls a URL the user typed. Mark secrets in `channelSecretFields`.
2. Add draft fields, `channelPayload`, `draftFromChannel`, and `fieldFor` so the form can validate with `channelFieldErrors`. A saved secret must count as filled. An optional secret needs a clear control.
3. Handle the type in `deliverChannel`. Build the down, recovery, and flapping text with `notificationText` so the wording matches the other channels. Return `{ ok: false, error }` on a non-2xx response or a blocked URL. Do not throw past the helper. Do not retry the HTTP call: the scheduler invocation that confirmed the outage has a 50-subrequest budget, and email already retries through the mail outbox.
4. Add a unit test in `worker/notify/dispatch.test.ts` with a fake `fetch`. Cover the payload, a non-2xx error, and a private URL that must not call `fetch`. Add schema cases in `shared/channels.test.ts` for validation, redaction, and secret merge. Do not import `worker/mail/smtp.ts` or `cloudflare:sockets` from a Node test.
5. Show the fields in `ChannelFields` with helper text on every field. Add an icon in `channel-catalog.tsx`. The type picker is a searchable list, not a native `<select>`.
6. Add the strings to `brand/locale.json`, including a status error such as `error_ntfy_status`. Run `pnpm copy:check`. Mention the type in `docs/notifications.md` and the feature list in `README.md`.

## Verification

```bash
pnpm test:unit
pnpm typecheck
```

Create the channel in `pnpm dev` and use Send test. Email channels go through `MailTransport` and report a stage. Other channels call the remote URL once and show the status error from `deliverChannel`.
