# Development

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

Useful scripts:

| Script                  | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm typecheck`        | Compiles locales, generates Worker types, typechecks the client and the Worker |
| `pnpm test`             | Vitest in Node, then Vitest on the Workers pool with local D1                  |
| `pnpm test:worker`      | API, scheduler, and SMTP-stage tests                                           |
| `pnpm e2e`              | Playwright against `pnpm dev`. `FLAREBOT_SHOTS=1` refreshes `docs/images/`     |
| `pnpm i18n:check`       | Key and placeholder parity for `en` and `ko`                                   |
| `pnpm lint:lang`        | Rejects non-Latin text outside locale files                                    |
| `pnpm brand:check`      | Scope gate, contrast, typecheck, unit tests                                    |
| `pnpm db:migrate:local` | Applies `migrations/` to local D1                                              |

Hooks are Lefthook (`pnpm install` runs `lefthook install`). Pre-commit formats the staged files, checks language, and typechecks. Pre-push runs tests, `i18n:check`, the production build, and Playwright. Commit messages follow Conventional Commits. If `core.hooksPath` points somewhere else, Lefthook still needs an executable `pre-commit`, `commit-msg`, and `pre-push` in `.git/hooks` so that dispatcher can chain to them.

Worker tests import the Hono app and the `cloudflare:test` env. They do not import `worker-mailer` from a Node test, because that package loads `cloudflare:sockets`.

Generated files `src/paraglide/` and `worker-configuration.d.ts` are gitignored. CI regenerates them.
