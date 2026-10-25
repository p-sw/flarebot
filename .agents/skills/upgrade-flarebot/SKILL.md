---

name: upgrade-flarebot
description: Update a branded Flarebot checkout from upstream while keeping brand/. Use when pulling a new Flarebot release into a deployment that has local branding.
---

# Upgrade Flarebot

## Allowed files

During the merge, keep the deployer's `brand/` tree. Resolve conflicts in `brand/` by keeping the deployer's version unless `brand/MIGRATION.md` in the incoming release says a slot prop or token name changed.

## Steps

1. Fetch upstream: `git fetch upstream` (or the remote that tracks `p-sw/flarebot`).
2. Read the incoming `brand/MIGRATION.md` before merging.
3. `git merge upstream/main`. If git reports conflicts outside `brand/`, take upstream. If it reports conflicts inside `brand/`, keep the deployer's branding unless the migration note says a prop was renamed.
4. If `brandApi` in upstream `shared/brand.ts` is greater than `brand/brand.config.ts`, follow `brand/MIGRATION.md` and bump `brandApi` only after the config matches the new type.
5. Run `pnpm install`.

## Verification

```bash
pnpm i18n:check
pnpm typecheck
pnpm test
pnpm brand:check
```

Do not commit `.dev.vars`, `src/paraglide/`, or `worker-configuration.d.ts`.
