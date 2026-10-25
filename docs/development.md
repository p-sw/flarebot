# Development

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

Useful scripts:

| Script                  | What it does                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Compiles locales, generates Worker types, typechecks the client and the Worker                                                                                 |
| `pnpm test`             | Vitest in Node, then Vitest on the Workers pool with local D1                                                                                                  |
| `pnpm test:worker`      | API, scheduler, and SMTP-stage tests                                                                                                                           |
| `pnpm test:e2e`         | Chromium smoke tests against `vite preview` (build, then port 4173). Seeds the owner once, then runs the specs in parallel. Brand screenshots are not included |
| `pnpm test:coverage`    | Unit and Worker coverage summaries                                                                                                                             |
| `pnpm brand:preview`    | Playwright screenshots of the dashboard for a rebrand. Not part of `pnpm test:e2e`                                                                             |
| `pnpm i18n:check`       | Key and placeholder parity for `en` and `ko`                                                                                                                   |
| `pnpm lint:lang`        | Rejects non-Latin text outside locale files                                                                                                                    |
| `pnpm brand:check`      | Scope gate, contrast, typecheck, unit tests                                                                                                                    |
| `pnpm db:migrate:local` | Applies `migrations/` to local D1                                                                                                                              |

Hooks are Lefthook (`pnpm install` runs `lefthook install`). Pre-commit formats the staged files, checks language, and typechecks. Pre-push runs the Vitest suites, `i18n:check`, and the production build. Playwright stays out of that hook so a push stays on the fast path; run `pnpm test:e2e` when you change the UI. Commit messages follow Conventional Commits. If `core.hooksPath` points somewhere else, Lefthook still needs an executable `pre-commit`, `commit-msg`, and `pre-push` in `.git/hooks` so that dispatcher can chain to them.

Worker tests import the Hono app and the `cloudflare:test` env. They do not import `worker-mailer` from a Node test, because that package loads `cloudflare:sockets`.

Generated files `src/paraglide/` and `worker-configuration.d.ts` are gitignored. CI regenerates them.

GitHub Actions runs lint, typecheck, tests, the production build, and Playwright in parallel. A new push to a pull request cancels the in-progress run. The Playwright job copies `.dev.vars.example` to `.dev.vars` before the production build, because the Vite plugin writes those secrets into the preview bundle. It then applies local D1 migrations into `.wrangler/e2e` and serves that build with `vite preview`. That directory is separate from `pnpm dev`, so the two servers can run at once. `pnpm dev` is for local editing; it is not the CI browser target.
