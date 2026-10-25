# Brand directory

Everything in this directory is safe for a deployer to edit. Upstream Flarebot will not rely on your copy of these files matching the stock theme.

| Path                 | What it controls                                                                     |
| -------------------- | ------------------------------------------------------------------------------------ |
| `brand.config.ts`    | Name, logos, default locale, motion preset name, links                               |
| `tokens.css`         | shadcn color variables, in OKLCH                                                     |
| `motion.ts`          | Springs (soft, snappy, drawer), page transition, stagger, distance, sidebar duration |
| `copy/<locale>.json` | Overrides merged on top of `locales/<locale>.json`                                   |
| `assets/`            | Logo files referenced by the config                                                  |
| `overrides/`         | Header, footer, status hero, empty state, login backdrop                             |
| `ui/`                | Components you have ejected                                                          |

`brandApi` is `1`. Read `MIGRATION.md` before changing it.

Run `pnpm brand:check` after a rebrand. A dirty git tree that touches files outside `brand/` fails the scope gate.
