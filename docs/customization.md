# Customization

Deployers rebrand Flarebot by asking their own coding agent. The agent should follow [AGENTS.md](../AGENTS.md) and the skills in `.agents/skills/`.

Start with the `rebrand` skill. It lists the only files a visual change may touch. `pnpm brand:check` refuses a dirty tree that edits anything outside `brand/`, then checks contrast, types, and unit tests. `pnpm brand:preview` writes light and dark screenshots to `.brand-preview/` (gitignored).

Motion is centralized in `brand/motion.ts`. Page transitions read `spring.soft`, lists and dialogs read `spring.snappy`, and the mobile navigation sheet reads `spring.drawer`. `sidebarMs` is the desktop sidebar width transition. Set `page` to `none` to turn movement off. Do not hardcode stiffness or damping in `src/`.

Slots in `brand/overrides/` are the supported places for layout changes that tokens cannot express. Eject a control with `pnpm eject button` when you need to replace the markup. Ejected components live in `brand/ui/` and win over `src/ui/` at build time.

Copy overrides in `brand/copy/<locale>.json` replace catalog strings after the locale file is loaded. Missing keys fall through to `locales/<locale>.json`.

Pulling a newer Flarebot is the `upgrade-flarebot` skill. Read `brand/MIGRATION.md` first.
