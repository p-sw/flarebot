# Contributing

Flarebot is licensed under MIT. By contributing you agree that your changes are released under that license.

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

GitHub Actions runs those commands as parallel jobs, plus Playwright. Pre-push runs the Vitest suites, `i18n:check`, and the production build. `pnpm test:e2e` is the browser smoke test (`pnpm exec playwright install chromium` first). `pnpm brand:preview` is separate and is not part of that smoke test.

## Branding versus product code

Visual changes for a deployment stay in `brand/`. Product changes (monitors, API, scheduler) stay outside it. See `AGENTS.md` and `docs/decisions.md`.

## Scope

This repository's first release is the MVP in the project plan. Multi-region checks, Cloudflare Access enforcement, status-page subscriptions, maintenance windows, and public incident posts are extension points, not unfinished bugs. Please open an issue before building one of those.
