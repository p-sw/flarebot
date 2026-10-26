# Flarebot

Self-hosted uptime monitoring and status pages on Cloudflare Workers.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020)](https://workers.cloudflare.com/)

Flarebot checks HTTP, TCP, DNS, certificate expiry, and heartbeat endpoints, confirms an outage before it notifies you, and publishes a status page. It runs entirely on the Workers free plan: a Hono API, Durable Objects for the schedule and the mail outbox, D1 for configuration and uptime rollups, and Analytics Engine for raw samples.

## Preview

<table>
  <tr>
    <td width="410" align="center" valign="top">
      <img src="docs/images/dashboard.webp" alt="Console dashboard" width="410" height="444" />
      <br />
      Console dashboard
    </td>
    <td width="410" align="center" valign="top">
      <img src="docs/images/status.webp" alt="Public status page" width="410" height="631" />
      <br />
      Public status page
    </td>
  </tr>
</table>

The dashboard lists every monitor. Expand a row to see recent response time. The images in this file are from a local demo database. Regenerate them with `pnpm screenshots`. That command does not read production data.

## Table of contents

- [Preview](#preview)
- [Table of contents](#table-of-contents)
- [Features](#features)
- [Deploy](#deploy)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Branding your deployment](#branding-your-deployment)
- [Updating](#updating)
- [Development](#development)
- [License](#license)

## Features

- HTTP, TCP, DNS, SSL expiry (CT-log estimate), and heartbeat monitors
- Email (SMTP or Cloudflare Email Service), Discord, Slack, Telegram, webhooks, ntfy, Gotify, Pushover, Microsoft Teams, Google Chat, and Matrix
- Public status pages, works in site root
- Manual incidents with a public timeline, and maintenance windows that hold alerts and stay out of the uptime percentage
- Visitor subscriptions on a status page: confirmed email, signed webhooks, and cached RSS and Atom feeds
- Uptime and response charts from local rollups
- Public SVG badges for status, uptime, and response time. A private monitor returns an unknown badge
- Owner, Admin, Editor, and Viewer roles, passkeys, passwords, optional TOTP, scoped API tokens, and optional OpenID Connect or Cloudflare Access sign-in
- One English copy file, `brand/locale.json`. A fork edits that file to translate the whole product
- Rebrand by editing `brand/` and asking your own coding agent

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/p-sw/flarebot)

The button provisions D1 from the placeholder database id in `wrangler.jsonc`. It does not set secrets. After it finishes:

```bash
npx wrangler secret put SETUP_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

`ENCRYPTION_KEY` is 32 bytes of base64 (`openssl rand -base64 32`). Open `/setup`, enter the setup secret, and create the Owner. After that, sign in at `/login`. The admin UI is `/console`. Owners and Admins can add OpenID Connect and Cloudflare Access in Settings. The Authentik steps, and the steps for Authentik behind Cloudflare Access, are in [docs/sso.md](docs/sso.md). Mail can wait. See [docs/deployment.md](docs/deployment.md) for the manual path and for SMTP secrets.

Nothing in this repository is deployed for you. The Wrangler config has no account id.

## Run locally

Node 22 and pnpm 10.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm exec playwright install chromium   # only for end-to-end tests
pnpm dev
```

Open http://127.0.0.1:5173/setup. The sample setup secret is `change-me-setup-secret`. Replace it before you expose the dev server. Sign in at `/login`. The admin UI is `/console`.

## Configuration

| Name                                                     | Purpose                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `SETUP_SECRET`                                           | Required. Setup stays closed until this is set.         |
| `ENCRYPTION_KEY`                                         | Required. Encrypts tokens, TOTP, and the SMTP password. |

Details: [docs/configuration.md](docs/configuration.md). Email behavior: [docs/email.md](docs/email.md).

## Branding your deployment

The files a deployer is meant to change live in [`brand/`](brand/). Colors, type, motion, copy, logos, and a few slot components are there so a later `git pull` of Flarebot does not fight your theme.

The step-by-step guide for a coding agent is [docs/customization.md](docs/customization.md): fork or use the deploy button, edit only `brand/`, review with `pnpm brand:check` and `pnpm brand:preview`, deploy, and pull upstream without losing the theme.

Ask your agent to follow [AGENTS.md](AGENTS.md). The skills in [`.agents/skills/`](.agents/skills/) cover a rebrand, translating the UI, ejecting a component, upgrading, a notification channel, a monitor type, or a mail driver. `pnpm brand:check` fails if a rebrand spills outside `brand/`.

## Updating

```bash
git pull
pnpm install
pnpm exec wrangler d1 migrations apply DB --remote
pnpm deploy
```

If you have local branding, use the `upgrade-flarebot` skill and read [brand/MIGRATION.md](brand/MIGRATION.md) before you merge.

## Development

[docs/development.md](docs/development.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Hooks format staged files, typecheck, and require Conventional Commits. GitHub Actions runs the same checks plus Playwright. `pnpm screenshots` rewrites the two preview images in this file from local demo data.

## License

[MIT](LICENSE). Copyright (c) 2026 Shinwoo PARK.

The footer shows a source link when `brand/brand.config.ts` sets `links.source`. The stock config points at this repository. Clear that field to hide the link. It is a default, not a license requirement.
