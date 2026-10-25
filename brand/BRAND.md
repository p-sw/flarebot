# Brand directory

Everything in this directory is safe for a deployer to edit. Upstream Flarebot will not rely on your copy of these files matching the stock theme.

| Path              | What it controls                                                                     |
| ----------------- | ------------------------------------------------------------------------------------ |
| `brand.config.ts` | Logos, motion preset name, links. Visible name is `locale.json` `app_name`           |
| `tokens.css`      | shadcn color variables, in OKLCH                                                     |
| `motion.ts`       | Springs (soft, snappy, drawer), page transition, stagger, distance, sidebar duration |
| `locale.json`     | Every user-facing string, plus `lang` for `<html lang>` and `Intl`                   |
| `assets/`         | Logo files referenced by the config                                                  |
| `overrides/`      | Header, footer, status hero, empty state, login backdrop                             |
| `ui/`             | Components you have ejected                                                          |

`brandApi` is `1`. Read `MIGRATION.md` before changing it.

Run `pnpm brand:check` after a rebrand. A dirty git tree that touches files outside `brand/` fails the scope gate.
