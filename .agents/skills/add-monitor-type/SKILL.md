---

name: add-monitor-type
description: Add a monitor check type. Use when extending Flarebot with a new probe such as a future domain-expiry check. Do not implement v1-only behavior unless the task says to.
---

# Add a monitor type

## Allowed files

- `shared/schemas.ts`
- `worker/checks/evaluate.ts` and its test
- `worker/checks/run.ts` (the only file that may import `cloudflare:sockets`)
- `worker/scheduler/shard.ts` if the snapshot needs a new field
- `migrations/` and `worker/db/schema.ts` if the type needs its own table. Certificate rows already use `cert_info`.
- `locales/en.json`, `locales/ko.json`
- `src/pages/monitors.tsx`

## Steps

1. Add the type to `monitorTypeSchema` and a config schema. The minimum interval stays 60 seconds. Reject private hosts.
2. Implement evaluation as a pure function in `worker/checks/evaluate.ts` and cover it with a Node unit test.
3. Call that function from `runCheck` in `worker/checks/run.ts`. Map transport failures through `classifyFetchError`. If the external lookup fails but the target might still be healthy, return `internalFailure` so the state machine records `unknown` and does not page anyone.
4. The scheduler already stores `regions` and runs `regions[0]`. Do not add a second region execution. That is v1 work.
5. Extend the create form so the API receives `{ type, config }` matching the zod schema.
6. Keep the first check on create. `runInitialCheck` already calls `runCheck`.

## Verification

```bash
pnpm test:unit
pnpm test:worker
pnpm typecheck
```

Create one monitor of the new type with `pnpm dev` and confirm the dashboard at `/console` shows a status other than a thrown 500.
