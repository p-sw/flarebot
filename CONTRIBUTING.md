# Contributing

Flarebot is licensed under AGPL-3.0-only. By contributing you agree that your changes are released under that license.

## Language

Write issues, pull requests, commit messages, docs, skills, and code comments in English. Translations belong in `locales/` and `brand/copy/`. Optional translated readmes use the name `README.<locale>.md`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add heartbeat push url` or `fix: retry pending checks`. The commit-msg hook runs commitlint and the language check. Do not skip the hooks.

## Checks

Before you open a pull request:

```bash
pnpm lint
pnpm lint:lang
pnpm i18n:check
pnpm typecheck
pnpm test
pnpm build
```

The same commands run in GitHub Actions. Pre-push also runs Playwright when a browser is installed (`pnpm exec playwright install chromium`).

## Branding versus product code

Visual changes for a deployment stay in `brand/`. Product changes (monitors, API, scheduler) stay outside it. See `AGENTS.md` and `docs/decisions.md`.

## Scope

This repository's first release is the MVP in the project plan. Multi-region checks, Cloudflare Access enforcement, status-page subscriptions, maintenance windows, and public incident posts are extension points, not unfinished bugs. Please open an issue before building one of those.
