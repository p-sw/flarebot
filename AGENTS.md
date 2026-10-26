# Flarebot agent guide

Flarebot is a self-hosted uptime monitor and status page that runs on Cloudflare Workers. People who deploy it rebrand the product by editing `brand/` and asking their own coding agent to follow the skills in `.agents/skills/`. Upstream code stays outside `brand/` so `git pull upstream` does not collide with a deployer's theme.

## Boundary

Edit only `brand/` when the task is a rebrand, a copy change, a motion change, or an ejected component. That directory holds:

- `brand/brand.config.ts` — logo paths, motion preset name, links. The visible product name is `messages.app_name` in the locale file
- `brand/tokens.css` — colors mapped onto the shadcn variables
- `brand/motion.ts` — springs (soft, snappy, drawer), page transition, stagger, distance, sidebar duration
- `brand/locale.json` — the only user-facing copy file. `lang` sets `<html lang>` and `Intl` formatting
- `brand/assets/` — logos
- `brand/overrides/` — slot components (header, footer, status hero, empty state, login backdrop)
- `brand/ui/` — components copied out of `src/ui/` with `pnpm eject`

Do not change Worker behavior, the database, or `src/` for a visual rebrand. `pnpm brand:check` fails when a dirty tree touches anything outside `brand/` (generated preview files under `.brand-preview/` are ignored). On a clean tree the scope gate is skipped so upstream CI can pass, and the contrast, typecheck, and unit-test steps still run. The deployer walkthrough is [docs/customization.md](docs/customization.md).

## Commands

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
pnpm typecheck
pnpm test
pnpm copy:check
pnpm lint:lang
pnpm brand:check
pnpm brand:preview
```

`pnpm dev` serves the Worker on http://127.0.0.1:5173 with local D1 and Durable Objects. The admin UI lives at `/console` and sign-in is `/login`. The first account is created at `/setup` and requires `SETUP_SECRET`. After setup, `/setup` redirects to `/login`. `/` serves the status page marked as the site root, or redirects to `/login` when none is set. `/s/:slug` stays available for every published page, including the root page.

## Skills

| Skill                      | Use when                                               |
| -------------------------- | ------------------------------------------------------ |
| `rebrand`                  | Changing name, color, type, motion, or marketing copy  |
| `eject-component`          | A deployer needs to restyle one control                |
| `upgrade-flarebot`         | Pulling upstream without losing `brand/`               |
| `translate-ui`             | Translating the product by editing `brand/locale.json` |
| `add-notification-channel` | Adding a notification driver                           |
| `add-monitor-type`         | Adding a check type                                    |
| `add-mail-driver`          | Adding an outbound mail transport                      |

Claude Code reads the same files through `CLAUDE.md` and `.claude/skills`, which point at this guide and `.agents/skills`.

## Repository language

English is the language of the repository: docs, skills, comments, commit messages, and pull requests. The one place a fork may use another language is `brand/locale.json`. `pnpm lint:lang` enforces that. There is no language picker and no second catalog.

## Checks and alerts

Monitors move from the first failure to `pending`, then to `down` after the configured retries. Notifications fire on confirmed down, recovery, and a single flapping notice. Raw samples go to Analytics Engine. Uptime percentages are computed from D1 rollups plus the shard's unflushed hour.
