# Email

Flarebot sends mail through a `MailTransport` interface. Invitation, password-reset, alert, and test messages are sentences in `brand/locale.json`.

- **SMTP** uses Workers TCP sockets and the pinned `worker-mailer@1.3.0` package. Port 587 starts TLS after the greeting. Port 465 is implicit TLS. Security `none` sends without encryption. Port 25, private hosts, and hosts that are not publicly dialable are rejected before connect, with stage `config`.
- **Cloudflare Email Service** uses the optional `EMAIL` binding. It is not in the committed Wrangler config. A missing binding fails with reason `missing_binding`.
- **Test** succeeds immediately and exists only when `ALLOW_TEST_MAIL=1`. With that flag, the settings test also accepts loopback hosts (`127.0.0.1`, `localhost`, `::1`) on ports 1024–65535. Production does not set the flag, so those ports return `unsupported_port`.

Invites, password resets, alert emails, and visitor subscription messages are written to `mail_outbox` and delivered by the `Mailer` Durable Object. Subscription messages add `List-Unsubscribe` and `List-Unsubscribe-Post` headers. See [subscriptions](subscriptions.md). Retries are 1 minute, 5 minutes, 30 minutes, and 2 hours, then the row is marked failed. Authentication and most 5xx responses are permanent. Network errors are transient. Timeouts are reported as stage `connect`.

Worker secrets override the database row whenever `SMTP_HOST` and `MAIL_FROM` are both present. `SMTP_HOST` without `MAIL_FROM` does not override.

## Settings

An Admin or Owner configures mail under Settings. The page states which source is actually used:

- **Worker secrets**, when `SMTP_HOST` and `MAIL_FROM` are both set. The form can still be saved, and those saved values are used only after the secrets are removed.
- **SMTP settings saved in D1**, when the driver is External SMTP and the secrets above are not set.
- **Cloudflare Email Service**, when the driver is Cloudflare Email Service and the `EMAIL` `send_email` binding is present. If the driver is selected without that binding, the page says mail cannot be sent yet.
- **None**, when email is turned off.

The SMTP form collects host, port (`587` or `465`), security (STARTTLS, TLS, or none), username, password, from address, and from name. The host must be a DNS-only public hostname. Private addresses, localhost, and Cloudflare-proxied names are rejected with reason `blocked_host`. Port 25 is `port_25`. Any other port is `unsupported_port`. The password is encrypted with `ENCRYPTION_KEY` before it is written to `mail_settings.password_encrypted`. The API returns `hasPassword` and never returns the password or ciphertext. Leave the password blank to keep the saved one, enter a new value to replace it, or clear it.

Send test posts the current form. It uses the same payload as save, plus an optional recipient. An empty recipient uses the signed-in account. An empty password uses the stored password and does not require a new encryption. The request does not save settings. When Worker secrets override, the test sends through those secrets and ignores the form.

`last_test_ok`, `last_test_at`, and `last_test_error` are updated only when a row already exists, secrets are not overriding, and the tested values match that row. A blank password matches the stored password. A typed password matches only when it decrypts to the same value. `clearPassword` matches only when no password is stored. The stored error is JSON `{stage, reason, detail}`. Saving a different configuration, including a new password or a cleared password, clears the last test. The page labels that result as the last test of the saved settings.

Failure responses are HTTP 400 `{ ok: false, source, recorded, secretsOverride, error: { code: "mail", message, stage, reason?, detail? } }`. Success is HTTP 200 `{ ok: true, source, recorded, secretsOverride }`. `source` is `secrets`, `saved`, or `form`. `message` and the admin UI both read `brand/locale.json` (`mail_stage_*`, `mail_reason_*`, and the test-mail subject and body). `detail` is a sanitized SMTP reply for delivery failures. Config reasons are `not_configured`, `missing_from`, `incomplete_smtp`, `port_25`, `unsupported_port`, `blocked_host`, `missing_binding`, and `missing_encryption_key`.
