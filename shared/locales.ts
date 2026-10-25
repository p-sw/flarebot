// SPDX-License-Identifier: MIT

export type SupportedLocale = "en" | "ko";

export const SUPPORTED_LOCALES = [
  { code: "en" as const, name: "English", dir: "ltr" as const },
  { code: "ko" as const, name: "Korean", dir: "ltr" as const },
];

export const LOCALE_CODES = SUPPORTED_LOCALES.map((locale) => locale.code);

export function isSupportedLocale(value: string): value is SupportedLocale {
  return LOCALE_CODES.includes(value as SupportedLocale);
}

export function matchLocale(
  header: string | null | undefined,
  available: readonly string[],
  fallback: string,
): { locale: string; fromHeader: boolean } {
  if (!header) return { locale: fallback, fromHeader: false };
  const ranked = header
    .split(",")
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(";");
      const tag = tagRaw?.trim().toLowerCase() ?? "";
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.tag)
    .sort((a, b) => b.q - a.q);

  for (const item of ranked) {
    const base = item.tag.split("-")[0] ?? item.tag;
    const exact = available.find((code) => code.toLowerCase() === item.tag);
    if (exact) return { locale: exact, fromHeader: true };
    const prefix = available.find((code) => code.toLowerCase() === base);
    if (prefix) return { locale: prefix, fromHeader: true };
  }
  return { locale: fallback, fromHeader: false };
}
