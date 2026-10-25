---

name: add-mail-driver
description: Add an outbound mail driver behind MailTransport. Use when a deployment needs a mail API other than SMTP or Cloudflare Email Service.
---

# Add a mail driver

## Allowed files

- `worker/mail/` (new driver module plus `resolve.ts`)
- `shared/schemas.ts` `mailSettingsSchema` if the driver has settings
- `worker/db/schema.ts` and a new migration only if the single `mail_settings` row cannot store the settings in existing columns
- `src/pages/manage.tsx` settings form
- `locales/en.json` and `locales/ko.json`

## Steps

1. Add a function that returns `MailResult`: `{ ok: true }` or `{ ok: false, stage, message, permanent }`. Stages are `config`, `connect`, `tls`, `auth`, `send`, or `timeout` (see `worker/mail/retry.ts`).
2. Teach `resolveMail` to select the driver. Worker secrets `SMTP_HOST` and `MAIL_FROM` keep overriding the database row for the SMTP driver. Do not let a new driver bypass that override when those secrets are set.
3. The `test` driver is only registered when `ALLOW_TEST_MAIL=1`. Do not enable it in production config.
4. Send the settings test with `deliverWith` directly so the button can report the failing stage. Password reset and invite mail stay on the outbox and the `Mailer` Durable Object.
5. Reject port 25, private hosts, and hosts that are not publicly dialable before opening a socket.

## Verification

```bash
pnpm test:worker
pnpm typecheck
```

Point the driver at an unreachable public test address such as `192.0.2.1` and confirm the test endpoint returns the stage instead of a generic 500.
