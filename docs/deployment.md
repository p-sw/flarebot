# Deployment

Flarebot targets the Cloudflare Workers free plan. Do not add Queues or KV on a hot path. The checked-in `wrangler.jsonc` uses the placeholder D1 id `00000000-0000-0000-0000-000000000000` and contains no account id. The Deploy to Cloudflare button replaces that id when it provisions a database.

## Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/p-sw/flarebot)

After the button finishes:

1. `npx wrangler secret put SETUP_SECRET` and `npx wrangler secret put ENCRYPTION_KEY`.
   `ENCRYPTION_KEY` is 32 bytes of base64 (`openssl rand -base64 32`).
2. Open the workers.dev (or custom) URL at `/setup` and create the Owner. When setup is finished, `/setup` sends you to `/login`, and the admin UI is `/console`. `/` stays a redirect to `/login` until a status page is set as the site root.
3. Optional: `npx wrangler secret put SMTP_HOST` plus `SMTP_PORT`, `SMTP_SECURE` (`starttls` or `tls`), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, and `MAIL_FROM_NAME`. These override the database mail settings.
4. Cloudflare Email Service is not bound in the committed config, because the deploy button does not provision it. Add a `send_email` binding named `EMAIL` later if you choose that driver in Settings.

The `deploy` script builds the app, applies D1 migrations to the remote database, then runs `wrangler deploy`. The build deletes `.dev.vars` from `dist/` before deploy. Secrets are not written into the Worker script or the client assets. Set them with `wrangler secret put` so the Worker reads them from `env` at runtime. The Deploy to Cloudflare button runs the same build from a checkout that has no `.dev.vars`.

## Manual

```bash
pnpm install
npx wrangler login
npx wrangler d1 create flarebot
```

Paste the returned database id over the placeholder in `wrangler.jsonc`. Then:

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler secret put SETUP_SECRET
pnpm exec wrangler secret put ENCRYPTION_KEY
pnpm deploy
```

Cron `*/5 * * * *` only wakes the scheduler and the mailer. The Durable Object alarms do the actual checks.

## Local

```bash
cp .dev.vars.example .dev.vars
pnpm dev
```

The dev server listens on http://127.0.0.1:5173. Local D1 and Durable Objects live under `.wrangler/`.
