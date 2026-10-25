# Configuration

Secrets and variables live in `.dev.vars` locally and in Worker secrets in production. Nothing account-specific is committed.

| Name                                         | Required   | Purpose                                                                                                             |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `SETUP_SECRET`                               | yes        | Gates `/api/setup`. If it is missing, setup returns 503 so a fresh deploy cannot be claimed by the public internet. |
| `ENCRYPTION_KEY`                             | yes        | 32-byte base64 key for channel configs, heartbeat tokens, TOTP secrets, and the SMTP password.                      |
| `SMTP_HOST`, `MAIL_FROM`                     | no         | When both are set, they override the mail row in D1.                                                                |
| `SMTP_PORT`                                  | no         | `587` (STARTTLS) or `465` (TLS). Port 25 is rejected.                                                               |
| `SMTP_SECURE`                                | no         | `starttls` (default) or `tls`.                                                                                      |
| `SMTP_USER`, `SMTP_PASSWORD`                 | no         | SMTP credentials.                                                                                                   |
| `MAIL_FROM_NAME`                             | no         | Display name.                                                                                                       |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no         | When the secret is set, setup and login require a Turnstile token.                                                  |
| `ALLOW_TEST_MAIL`                            | tests only | Set to `1` to allow the in-memory `test` mail driver. Do not set this in production.                                |

`DEFAULT_LOCALE` in `wrangler.jsonc` is `en`. The Owner can change the instance name and default locale in Settings. Auth mode `access` is stored as a future switch and the API returns 501 if you try to enable it.

Minimum monitor interval is 60 seconds. Faster intervals are rejected until a later release.
