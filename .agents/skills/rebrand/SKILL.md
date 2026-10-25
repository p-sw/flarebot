---

name: rebrand
description: Rebrand a Flarebot deployment by editing only brand/. Use when asked to change the product name, logo, colors, type, motion, or marketing copy.
---

# Rebrand Flarebot

Change the deployer's product without editing upstream files.

## Allowed files

- `brand/brand.config.ts`
- `brand/tokens.css`
- `brand/motion.ts`
- `brand/copy/*.json`
- `brand/assets/**`
- `brand/overrides/**`
- `brand/ui/**` only after `pnpm eject <component>`

## Steps

1. Read `brand/brand.config.ts` and `brand/BRAND.md`.
2. Change `name`, `logo`, `links`, and `motion` (`calm`, `crisp`, `playful`, or `none`). Keep `brandApi` at `1`.
3. Put logo files in `brand/assets/` and point `logo.light` and `logo.dark` at those paths.
4. Edit `brand/tokens.css`. Keep every variable name. Use `oklch()`. Text colors must clear WCAG AA 4.5:1 against the surfaces they sit on.
5. If the motion name changed, update `brand/motion.ts` springs. Components read this file. Do not hardcode stiffness or damping in `src/`.
6. Override product sentences in `brand/copy/en.json` and `brand/copy/ko.json`. Keys must already exist in `locales/en.json`. Placeholders such as `{name}` must stay.
7. Restyle a slot by editing the matching file in `brand/overrides/`. Keep the exported props the same.

## Verification

```bash
pnpm brand:check
pnpm brand:preview
pnpm i18n:check
```

`brand:check` fails if git shows changes outside `brand/`. On a clean checkout it still typechecks and checks contrast. Preview screenshots land in `.brand-preview/`.
