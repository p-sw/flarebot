---

name: add-notification-channel
description: Add a notification channel type to Flarebot. Use when implementing Discord-like delivery for a new service such as a webhook variant or a chat platform.
---

# Add a notification channel

## Allowed files

- `shared/schemas.ts` (`channelTypeSchema`, `parseChannelConfig`)
- `worker/notify/dispatch.ts` and `worker/notify/dispatch.test.ts`
- `worker/scheduler/shard.ts` only if the new type needs extra context on the alert
- `locales/en.json` and `locales/ko.json` for form labels
- `src/pages/manage.tsx` (channel form)
- `migrations/` only if a new column is required. Prefer storing the config inside the existing encrypted JSON.

## Steps

1. Add the type string to `channelTypeSchema` and a zod object in `parseChannelConfig`. Reject private URLs with the same host rules as HTTP monitors when the channel calls a URL.
2. Handle the type in `deliverChannel`. Return `{ ok: false, error }` on a non-2xx response. Do not throw past the helper.
3. Add a unit test in `worker/notify/dispatch.test.ts` with a fake `fetch`. Do not import `worker/mail/smtp.ts` or `cloudflare:sockets` from a Node test.
4. Show the new fields on the channel form. Encrypting the config is already handled by the API when it stores `configEncrypted`.
5. Add English and Korean strings. Run `pnpm i18n:check`.

## Verification

```bash
pnpm test:unit
pnpm typecheck
```

Create the channel in `pnpm dev` and use Send test. Email channels go through `MailTransport` and report a stage. Other channels call the remote URL directly.
