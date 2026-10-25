# Email

Flarebot sends mail through a `MailTransport` interface.

- **SMTP** uses Workers TCP sockets and the pinned `worker-mailer@1.3.0` package. Port 587 starts TLS after the greeting. Port 465 is implicit TLS. Port 25, private hosts, and hosts that are not publicly dialable are rejected before connect, with a stage of `config`.
- **Cloudflare Email Service** uses the optional `EMAIL` binding. It is not in the committed Wrangler config.
- **Test** succeeds immediately and exists only when `ALLOW_TEST_MAIL=1`.

The Settings test button calls the driver synchronously and returns the failing stage (`config`, `connect`, `tls`, `auth`, `send`, `timeout`). Invites, password resets, and alert emails are written to `mail_outbox` and delivered by the `Mailer` Durable Object. Retries are 1 minute, 5 minutes, 30 minutes, and 2 hours, then the row is marked failed. Authentication and most 5xx responses are permanent. Network errors are transient.

Worker secrets named `SMTP_*` and `MAIL_FROM` override the database row whenever `SMTP_HOST` and `MAIL_FROM` are both present.
