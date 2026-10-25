---

name: add-locale
description: Add an admin UI language to Flarebot. Use when a deployer or contributor wants a new locale besides English and Korean.
---

# Add a locale

## Allowed files

- `locales/<code>.json` (new catalog; a full translation of `locales/en.json`)
- `brand/copy/<code>.json`
- `shared/locales.ts` (register the code, English name, and direction)
- `project.inlang/settings.json` (add the code to `locales`)
- `scripts/i18n-compile.mjs` and `scripts/i18n-check.mjs` if they list locales explicitly
- Language switchers that read `SUPPORTED_LOCALES` do not need a new branch if they already map the list

Do not put the new language's sentences into README, skills, or code comments. The catalog file is the exception to the English-only rule.

## Steps

1. Copy `locales/en.json` to `locales/<code>.json` and translate every value. Keep every key and every `{placeholder}`.
2. Add `{ code, name, dir }` to `SUPPORTED_LOCALES` in `shared/locales.ts`. `name` must stay in English (for example `"German"`). The native name belongs in the new catalog.
3. Add the code to `locales` in `project.inlang/settings.json`.
4. Add the code to the `locales` array in `scripts/i18n-compile.mjs` and the loop in `scripts/i18n-check.mjs`.
5. Add an empty or partial `brand/copy/<code>.json`. Keys must exist in English.
6. Extend the account and shell `<select>` options if they are hardcoded to `en` and `ko`. Prefer reading `SUPPORTED_LOCALES` if you touch them.

## Verification

```bash
pnpm i18n:compile
pnpm i18n:check
pnpm lint:lang
pnpm typecheck
```

Open the app, switch to the new language, and confirm the sidebar and login form render the new catalog.
