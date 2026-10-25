// Paraglide compile options. Message catalogs are merged into .generated first.
export default {
  strategy: ["cookie", "preferredLanguage", "baseLocale"],
  // Keep this name aligned with LOCALE_COOKIE in shared/locales.ts.
  cookieName: "locale",
  cookieSameSite: "lax",
  cookieSecure: "auto",
  outputStructure: "locale-modules",
  disableAsyncLocalStorage: true,
  emitTsDeclarations: true,
  emitReadme: false,
  isServer: "typeof window === 'undefined'",
};
