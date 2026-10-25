# Email

Flarebot sends mail through a `MailTransport` interface.

- **SMTP** uses Workers TCP sockets and the pinned `worker-mailer@1.3.0` package. Port 587 starts TLS after the greeting. Port 465 is implicit TLS. Port 25, private hosts, and hosts that are not publicly dialable are rejected before connect, with a stage of `config`.
- **Cloudflare Email Service** uses the optional `EMAIL` binding. It is not in the committed Wrangler config.
- **Test** succeeds immediately and exists only when `ALLOW_TEST_MAIL=1`.

The Settings test button calls the driver synchronously and returns the failing stage (`config`, `connect`, `tls`, `auth`, `send`, `timeout`). Invites, password resets, and alert emails are written to `mail_outbox` and delivered by the `Mailer` Durable Object. Retries are 1 minute, 5 minutes, 30 minutes, and 2 hours, then the row is marked failed. Authentication and most 5xx responses are permanent. Network errors are transient.

Worker secrets named `SMTP_*` and `MAIL_FROM` override the database row whenever `SMTP_HOST` and `MAIL_FROM` are both present.

## Settings

An Admin or Owner configures mail under Settings. The page states which source is actually used:

- **Worker secrets**, when `SMTP_HOST` and `MAIL_FROM` are both set. The form can still be saved, and those saved values are used only after the secrets are removed.
- **SMTP settings saved in D1**, when the driver is External SMTP and the secrets above are not set.
- **Cloudflare Email Service**, when the driver is Cloudflare Email Service and the `EMAIL` `send_email` binding is present. If the driver is selected without that binding, the page says mail cannot be sent yet.
- **None**, when email is turned off.

The SMTP form collects host, port (`587` or `465`), security (STARTTLS, TLS, or none), username, password, from address, and from name. Port 25 is rejected. The password is encrypted with `ENCRYPTION_KEY` before it is written to `mail_settings.password_encrypted`. The API returns `hasPassword` and never returns the password. Leave the password blank to keep the saved one, enter a new value to replace it, or clear it. Send test uses the active source and reports the failing stage (`config`, `connect`, `tls`, `auth`, `send`, or `timeout`) when delivery does not succeed.
