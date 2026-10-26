# Development

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

The dev server is http://127.0.0.1:5173. Create the owner at `/setup`, sign in at `/login`, and use the admin UI at `/console`.

Useful scripts:

| Script                  | What it does                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Generates Worker types, then typechecks the client and the Worker                                                                                              |
| `pnpm test`             | Vitest in Node, then Vitest on the Workers pool with local D1                                                                                                  |
| `pnpm test:worker`      | API, scheduler, and SMTP-stage tests                                                                                                                           |
| `pnpm test:e2e`         | Chromium smoke tests against `vite preview` (build, then port 4173). Seeds the owner once, then runs the specs in parallel. Brand screenshots are not included |
| `pnpm test:coverage`    | Unit and Worker coverage summaries                                                                                                                             |
| `pnpm brand:preview`    | Playwright screenshots of the dashboard for a rebrand. Not part of `pnpm test:e2e`                                                                             |
| `pnpm screenshots`      | Rebuilds the README images from a local demo database. Not part of CI. It never reads production data                                                          |
| `pnpm copy:check`       | Every `t()` and `copy()` key exists in `brand/locale.json`, and UI files do not hardcode new sentences                                                         |
| `pnpm lint:lang`        | Rejects non-Latin text outside `brand/locale.json`                                                                                                             |
| `pnpm brand:check`      | Scope gate, contrast, typecheck, unit tests                                                                                                                    |
| `pnpm db:migrate:local` | Applies `migrations/` to local D1                                                                                                                              |

Hooks are Lefthook (`pnpm install` runs `lefthook install`). Pre-commit formats the staged files, checks language, and typechecks. Pre-push runs the Vitest suites, `copy:check`, and the production build. Playwright stays out of that hook so a push stays on the fast path; run `pnpm test:e2e` when you change the UI. Commit messages follow Conventional Commits. If `core.hooksPath` points somewhere else, Lefthook still needs an executable `pre-commit`, `commit-msg`, and `pre-push` in `.git/hooks` so that dispatcher can chain to them.

Worker tests import the Hono app and the `cloudflare:test` env. They do not import `worker-mailer` from a Node test, because that package loads `cloudflare:sockets`. Single sign-on is covered by `shared/sso.test.ts`, `worker/auth/jwt.test.ts`, and `test/sso.worker.test.ts`. Those tests sign tokens locally and do not call a real provider.

`worker-configuration.d.ts` is gitignored. CI regenerates it. Copy is read from `brand/locale.json` with no compile step.

GitHub Actions runs lint, typecheck, tests, the production build, and Playwright in parallel. A new push to a pull request cancels the in-progress run. `pnpm build` removes `.dev.vars` from `dist/` and fails if secret values remain in the Worker output or the client assets. Playwright copies that file back into `dist/flarebot/` only to boot `vite preview`. It then applies local D1 migrations into `.wrangler/e2e`. That directory is separate from `pnpm dev`, so the two servers can run at once. `pnpm dev` is for local editing; it is not the CI browser target. `pnpm screenshots` boots preview on port 4174 with `FLAREBOT_PERSIST=.wrangler/screenshots`, creates a local demo account and monitors, and writes the four README images. It does not call a remote database.
