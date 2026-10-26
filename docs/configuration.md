# Configuration

Secrets and variables live in `.dev.vars` locally and in Worker secrets in production. Nothing account-specific is committed.

| Name                                         | Required   | Purpose                                                                                                             |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `SETUP_SECRET`                               | yes        | Gates `/api/setup`. If it is missing, setup returns 503 so a fresh deploy cannot be claimed by the public internet. |
| `ENCRYPTION_KEY`                             | yes        | 32-byte base64 key for channel configs, heartbeat tokens, TOTP secrets, and the SMTP password.                      |
| `SMTP_HOST`, `MAIL_FROM`                     | no         | When both are set, they override the mail row in D1.                                                                |
| `SMTP_PORT`                                  | no         | `587` (STARTTLS) or `465` (TLS). Port 25 is rejected.                                                               |
| `SMTP_SECURE`                                | no         | `starttls` (default), `tls`, or `none`.                                                                             |
| `SMTP_USER`, `SMTP_PASSWORD`                 | no         | SMTP credentials.                                                                                                   |
| `MAIL_FROM_NAME`                             | no         | Display name.                                                                                                       |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | no         | When the secret is set, setup and login require a Turnstile token.                                                  |
| `ALLOW_TEST_MAIL`                            | tests only | Set to `1` to allow the in-memory `test` mail driver. Do not set this in production.                                |

Notification channels store their config in D1 encrypted with `ENCRYPTION_KEY`. The console masks secrets after they are saved. Supported types and how delivery stays inside the free-plan subrequest limit are described in [notifications.md](notifications.md).

The product language is `lang` in `brand/locale.json`. That value is the document language and the `Intl` locale for dates and numbers. There is no `DEFAULT_LOCALE` binding, no account language setting, and no `Accept-Language` detection. The Owner can change the instance name in Settings. That name is used in invitation, password-reset, and test email. When it is empty, those messages use `app_name` from the locale file. The Owner also chooses how many days of check history to keep. The default is 90. Presets are 7, 30, 90, 180, and 365 days, and a custom value may be any whole number from 1 to 3650. The value is the `history_retention_days` row in `settings`. Unset installs use 90 until someone saves another value. Sign-in is the built-in account form. The API rejects `authMode: "access"`.

Minimum monitor interval is 60 seconds. Faster intervals are rejected until a later release.
