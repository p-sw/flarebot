# Decisions

These choices were open in the plan or forced by the free-plan and local-dev constraints.

1. API token scopes are enforced now. Shipping a token without a scope check would let a viewer token change monitors.
2. SSL remaining days use the crt.sh CT log. A live handshake is only a fallback. An empty or failed log becomes `unknown`, not `down`, unless HTTPS itself reports a TLS error. Domain expiry (RDAP) is not implemented.
3. Passwords use PBKDF2-SHA-256 with 10,000 iterations so hashing fits a free-plan CPU budget.
4. The browser and the Worker share zod schemas instead of a Hono RPC client, because the two TypeScript projects do not share a DOM lib.
5. `brand:check` looks at uncommitted files. A clean tree skips the scope gate so CI passes. A dirty tree that leaves `brand/` fails.
6. Turnstile runs only when `TURNSTILE_SECRET_KEY` is set.
7. The `send_email` binding is not in `wrangler.jsonc`.
8. Routes are code-based TanStack Router routes. There is no file-route codegen step.
9. Git hooks use Lefthook: one file for pre-commit, commit-msg, and pre-push.
10. Each alarm runs at most 12 checks and 6 concurrent connects.
11. Recent results stay on the shard and flush about every five minutes and on state change.
12. Uptime percentages come from D1 rollups plus the unflushed shard hour. Analytics Engine is write-only from the Worker's point of view.
13. The setup wizard creates one organization.
14. Heartbeat tokens are encrypted so an editor can show the push URL again.
15. Intervals below 60 seconds are rejected.
16. Auth mode `access` can be requested and the API returns 501. It is not stored as enabled.
17. `isInMaintenance()` returns false. The alert path already calls it.
18. `regions` is stored. Only the first entry is checked.
19. JSON path support is `$.a.b`, `$.a[0]`, and `$['a']`.
20. Password reset and invite mail use the outbox. The test button does not.
21. Three transitions in 30 minutes produce one unstable alert.
22. The default theme is IBM Plex, a deep teal primary, a dark sidebar, and a warm paper canvas.
23. Source files carry `SPDX-License-Identifier: MIT`. The `LICENSE` file is the MIT text, copyright Shinwoo PARK, 2026.
24. The placeholder D1 id is the all-zero UUID so the deploy button can provision a database.
25. Setup is unavailable until `SETUP_SECRET` is set.
26. Five failed logins lock the account for 15 minutes.
27. The create and save requests run the first check so the UI has a result immediately. The sample is stored on the shard, so the response chart and today's status-page bar update before the five-minute flush.
28. `worker-mailer` is pinned to 1.3.0. The SMTP stage is inferred from the error text because the library bundles the handshake.
29. The session cookie is `flarebot_session`. A leftover `locale` cookie is ignored.
30. End-to-end tests seed the owner through `/api/setup` and then sign in over the API. They do not walk the setup wizard, and they do not call out to example.com or crt.sh. `ALLOW_TEST_MAIL=1` exists for the Worker test suite.
31. v1 tables (incident posts, maintenance, subscribers, Access role maps, domain expiry) are not created. `cert_info` exists for the SSL monitor.
32. `@cloudflare/vitest-pool-workers` was renamed to `@cloudflare/vitest-plugin`. The old package does not support Vitest 5, which Vite 8 requires.
33. HTTP keyword and JSON bodies are capped at 64 KB.
34. Language-prefixed paths and `?lang=` are not routed. Public pages render the stored title and description.
35. Passkey verification does not require the user-verification flag, so a security key without a PIN can still sign in. Password login still asks for TOTP when TOTP is enabled. A successful passkey login does not also ask for TOTP.
36. In this environment `git config core.hooksPath` points at Cursor's hook dispatcher. Lefthook shims are installed in `.git/hooks` so the dispatcher can chain to them. `core.hooksPath` is not changed. A normal clone still uses `lefthook install` from `pnpm install`. Git only runs `pre-push` when that name exists on the hooks path; the dispatcher directory originally had `pre-commit` and `commit-msg` only.
37. Route guards use `fetchQuery`. This Query version's `ensureQueryData` returns a cached signed-out session after login and sends the browser back to the sign-in form.
38. Pre-push runs unit tests, Worker tests, `copy:check`, and the production build. The Playwright smoke test stays in CI (browsers cached) and in `pnpm test:e2e`. It seeds state through the API. Screenshot capture is `pnpm brand:preview`, not the default end-to-end run.
39. SMTP tests dial a local mock only when `ALLOW_TEST_MAIL=1`. That flag lets `127.0.0.1` through the private-host check. Production config does not set the flag, so loopback stays blocked.
40. CI runs lint, typecheck, tests, the production build, and Playwright as separate jobs. A new commit on a pull request cancels the previous run. Playwright drives `vite preview` on port 4173, with two workers and `fullyParallel`. The e2e command copies `.dev.vars` into the preview output only after `pnpm build` has removed it. Without `SETUP_SECRET` the setup route returns 503. Brand screenshots stay on `pnpm brand:preview`.
41. `pnpm build` deletes every `.dev.vars` file from `dist/` and fails if a secret value remains anywhere in that output, or if a client asset contains `SETUP_SECRET` or `ENCRYPTION_KEY`. The Vite plugin writes `.dev.vars` beside the Worker for local preview. `wrangler deploy` and the Deploy to Cloudflare button run this build, so those values are not part of the uploaded Worker or the client assets. Production reads them from Worker secrets at runtime. The Worker script still mentions the binding names. That is how it reads `env`.
42. The footer source link is optional and on by default. `links.source` in `brand/brand.config.ts` is the GitHub URL, and the footer renders the link only when that field is set.
43. The admin UI is mounted at `/console`. `/login` is the sign-in page, and `/` is either the single status page with `serve_at_root = 1` or a redirect to `/login`. Old admin paths redirect to `/console/...`. Migration `0002_status_page_root.sql` adds that column with default `0` and a partial unique index. It does not rewrite existing rows. The public HTML for `/` and `/s/:slug` is `private, no-store` so a cache cannot keep the previous home page.
44. The product ships one copy file, `brand/locale.json`. `lang` in that file sets `<html lang>` and `Intl` dates and numbers. There is no language picker, no second catalog, and no Paraglide compile step. Deprecated locale columns stay in D1 and are not read. See `docs/architecture.md`.
45. Status page layout stays on `status_page_items`. `group_name` is the section and `position` is the order, so empty sections are not stored. The public item label is the display name, or the monitor name when the display name is blank. The home-page switch waits for the server before it changes. Create and replace run as one D1 batch. A replace does not rewrite the deprecated locale columns on the page row.
46. A paused monitor is not up and not down. The `paused` column wins over the last check, including on the public status page. Pausing parks the scheduler snapshot a year out and skips it in the alarm. Resuming sets the runtime to `pending` ("Checking") and arms the next check immediately. A page whose monitors are all paused uses overall `paused` ("All monitors are paused"). A mix of paused and healthy monitors stays operational; paused monitors are left out of the outage count. `GET /api/*` is `Cache-Control: private, no-store`. The admin cache writes the monitor returned by the pause request and does not wait on a second GET. Route loaders use `fetchQuery`, because this Query version's `ensureQueryData` returns the previous value after invalidation while `staleTime` is still in force.
