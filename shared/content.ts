// SPDX-License-Identifier: AGPL-3.0-only

export type I18nMap = Record<string, Record<string, string>>;

export function pickLocalized(
  fields: readonly string[],
  canonical: Record<string, string>,
  sourceLocale: string,
  i18n: I18nMap | null | undefined,
  requested: string,
  pageDefault: string,
): { values: Record<string, string>; langs: Record<string, string> } {
  const values: Record<string, string> = {};
  const langs: Record<string, string> = {};
  const chain = [requested, pageDefault, sourceLocale];
  for (const field of fields) {
    let chosen = "";
    let lang = sourceLocale;
    for (const locale of chain) {
      const fromI18n = i18n?.[locale]?.[field];
      const candidate =
        fromI18n && fromI18n.trim() !== ""
          ? fromI18n
          : locale === sourceLocale
            ? (canonical[field] ?? "")
            : "";
      if (candidate.trim() !== "") {
        chosen = candidate;
        lang = locale;
        break;
      }
    }
    if (chosen.trim() === "") {
      chosen = canonical[field] ?? "";
      lang = sourceLocale;
    }
    values[field] = chosen;
    langs[field] = lang;
  }
  return { values, langs };
}

export function missingTranslationCount(
  fields: readonly string[],
  locales: readonly string[],
  sourceLocale: string,
  i18n: I18nMap | null | undefined,
  canonical: Record<string, string>,
): number {
  let missing = 0;
  for (const locale of locales) {
    if (locale === sourceLocale) continue;
    for (const field of fields) {
      const value = i18n?.[locale]?.[field];
      if (!value || value.trim() === "") missing += 1;
    }
  }
  if (locales.includes(sourceLocale)) {
    for (const field of fields) {
      if (!(canonical[field] ?? "").trim()) missing += 1;
    }
  }
  return missing;
}
