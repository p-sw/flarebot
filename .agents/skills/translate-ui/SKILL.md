---

name: translate-ui
description: Translate the whole Flarebot product by editing brand/locale.json. Use when a fork wants the admin UI, status pages, emails, and errors in another language.
---

# Translate the UI

Flarebot ships one copy file. Translating it switches the product language. Do not add a second catalog, a language picker, or a locale cookie.

## Allowed files

- `brand/locale.json`

## Steps

1. Copy `brand/locale.json` and translate `messages` in place. Keep every key. Do not rename, add, or drop keys.
2. Keep `{placeholders}` such as `{name}`, `{link}`, and `{status}`. A translation that drops a placeholder fails `pnpm copy:check` only when the braces no longer balance; still keep the names the English string uses.
3. Keep plural forms. A value like `{count, plural, one {# monitor} other {# monitors}}` must stay a plural with an `other` branch. `#` is the formatted count. `Intl.PluralRules` picks the branch from `lang`, so Japanese and Korean use `other` for every count.
4. Set `lang` to the BCP 47 tag for that language, for example `ja`. It is the `<html lang>` value and the locale for `Intl` dates, times, and numbers. Dates render in UTC.
5. The visible product name is `messages.app_name`. Invitation, reset, and test mail use the instance name from Settings, and fall back to `app_name`. `brand/brand.config.ts` `name` is not shown. Align it with `app_name` if you still set it.
6. Keys that the current screens do not reference are still part of the file. Leave them translated so a later screen can use the same wording.

## Verification

```bash
pnpm copy:check
pnpm lint:lang
```

`copy:check` fails when code calls `t("key")` or `copy("key")` and that key is missing, and when a `.tsx` file hardcodes a new sentence. `lint:lang` allows non-Latin text only in `brand/locale.json`.
