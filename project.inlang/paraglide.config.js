// Paraglide compile options. Message catalogs are merged into .generated first.
export default {
  strategy: ["cookie", "preferredLanguage", "baseLocale"],
  cookieName: "locale",
  outputStructure: "locale-modules",
  disableAsyncLocalStorage: true,
  emitTsDeclarations: true,
  emitReadme: false,
  isServer: "typeof window === 'undefined'",
};
