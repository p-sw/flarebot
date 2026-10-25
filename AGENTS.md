# Flarebot agent guide

Flarebot is a self-hosted uptime monitor and status page that runs on Cloudflare Workers. People who deploy it rebrand the product by editing `brand/` and asking their own coding agent to follow the skills in `.agents/skills/`. Upstream code stays outside `brand/` so `git pull upstream` does not collide with a deployer's theme.

## Boundary

Edit only `brand/` when the task is a rebrand, a copy change, a motion change, or an ejected component. That directory holds:

- `brand/brand.config.ts` — product name, logo paths, default locale, motion preset name, links
- `brand/tokens.css` — colors mapped onto the shadcn variables
- `brand/motion.ts` — spring and page-enter presets
- `brand/copy/<locale>.json` — strings that override the locale catalogs
- `brand/assets/` — logos
- `brand/overrides/` — slot components (header, footer, status hero, empty state, login backdrop)
- `brand/ui/` — components copied out of `src/ui/` with `pnpm eject`

Do not change Worker behavior, the database, or `src/` for a visual rebrand. `pnpm brand:check` fails when a dirty tree touches anything outside `brand/` (generated preview files under `.brand-preview/` are ignored). On a clean tree the scope gate is skipped so upstream CI can pass, and the contrast, typecheck, and unit-test steps still run.

## Commands

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
pnpm typecheck
pnpm test
pnpm i18n:check
pnpm lint:lang
pnpm brand:check
pnpm brand:preview
```

`pnpm dev` serves the admin UI and the Worker on http://127.0.0.1:5173 with local D1 and Durable Objects. The first account is created at `/setup` and requires `SETUP_SECRET`.

## Skills

| Skill                      | Use when                                              |
| -------------------------- | ----------------------------------------------------- |
| `rebrand`                  | Changing name, color, type, motion, or marketing copy |
| `eject-component`          | A deployer needs to restyle one control               |
| `upgrade-flarebot`         | Pulling upstream without losing `brand/`              |
| `add-locale`               | Adding an admin UI language                           |
| `add-notification-channel` | Adding a notification driver                          |
| `add-monitor-type`         | Adding a check type                                   |
| `add-mail-driver`          | Adding an outbound mail transport                     |

Claude Code reads the same files through `CLAUDE.md` and `.claude/skills`, which point at this guide and `.agents/skills`.

## Repository language

English is the language of the repository: docs, skills, comments, commit messages, and pull requests. Other languages belong in `locales/<code>.json`, `brand/copy/<code>.json`, and optional `README.<locale>.md` files. `pnpm lint:lang` enforces that.

## Checks and alerts

Monitors move from the first failure to `pending`, then to `down` after the configured retries. Notifications fire on confirmed down, recovery, and a single flapping notice. Raw samples go to Analytics Engine. Uptime percentages are computed from D1 rollups plus the shard's unflushed hour.
