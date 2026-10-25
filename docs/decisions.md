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
23. Source files carry `SPDX-License-Identifier: AGPL-3.0-only`. The `LICENSE` file is the unmodified AGPL-3.0 text.
24. The placeholder D1 id is the all-zero UUID so the deploy button can provision a database.
25. Setup is unavailable until `SETUP_SECRET` is set.
26. Five failed logins lock the account for 15 minutes.
27. The create and save requests run the first check so the UI has a result immediately. The sample is stored on the shard, so the response chart and today's status-page bar update before the five-minute flush.
28. `worker-mailer` is pinned to 1.3.0. The SMTP stage is inferred from the error text because the library bundles the handshake.
29. Cookies are `flarebot_session` and `locale`.
30. End-to-end tests use the real setup wizard. There is no backdoor. `ALLOW_TEST_MAIL=1` exists for the Worker test suite.
31. v1 tables (incident posts, maintenance, subscribers, Access role maps, domain expiry) are not created. `cert_info` exists for the SSL monitor.
32. `@cloudflare/vitest-pool-workers` was renamed to `@cloudflare/vitest-plugin`. The old package does not support Vitest 5, which Vite 8 requires.
33. HTTP keyword and JSON bodies are capped at 64 KB.
34. Language-prefixed paths such as `/ko/` are not routed. The public page uses `?lang=`.
35. Passkey verification does not require the user-verification flag, so a security key without a PIN can still sign in. Password login still asks for TOTP when TOTP is enabled. A successful passkey login does not also ask for TOTP.
36. In this environment `git config core.hooksPath` points at Cursor's hook dispatcher. Lefthook shims are installed in `.git/hooks` so the dispatcher can chain to them. `core.hooksPath` is not changed. A normal clone still uses `lefthook install` from `pnpm install`.
37. Route guards use `fetchQuery`. This Query version's `ensureQueryData` returns a cached signed-out session after login and sends the browser back to the sign-in form.
