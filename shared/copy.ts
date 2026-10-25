// SPDX-License-Identifier: MIT

import catalog from "../brand/locale.json" with { type: "json" };

export type LocaleFile = {
  lang: string;
  messages: Record<string, string>;
};

type Catalog = typeof catalog;
export type MessageKey = keyof Catalog["messages"];
export type MessageParams = Record<string, string | number>;

const PLURAL = /\{(\w+),\s*plural,((?:\s*[a-z]+\s*\{[^{}]*\})+)\s*\}/g;

export function formatMessage(
  template: string,
  params: MessageParams | undefined,
  lang: string,
): string {
  const values = params ?? {};
  const withPlurals = template.replace(
    PLURAL,
    (_match, name: string, body: string) => {
      const count = Number(values[name] ?? 0);
      const category = new Intl.PluralRules(lang).select(
        Number.isFinite(count) ? count : 0,
      );
      const forms = new Map<string, string>();
      for (const match of body.matchAll(/([a-z]+)\s*\{([^{}]*)\}/g)) {
        const categoryName = match[1];
        const text = match[2];
        if (categoryName && text !== undefined) forms.set(categoryName, text);
      }
      const chosen = forms.get(category) ?? forms.get("other") ?? "";
      const rendered = new Intl.NumberFormat(lang).format(
        Number.isFinite(count) ? count : 0,
      );
      return chosen.replaceAll("#", rendered);
    },
  );
  return withPlurals.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(values[name] ?? ""),
  );
}

export function createCopy(file: LocaleFile) {
  function translate(key: string, params?: MessageParams): string {
    const template = file.messages[key];
    if (template === undefined) throw new Error(`Missing copy key: ${key}`);
    return formatMessage(template, params, file.lang);
  }
  return { lang: file.lang, t: translate };
}

export const textLang: string = catalog.lang;

export function t<K extends MessageKey>(
  key: K,
  params?: MessageParams,
): string {
  return formatMessage(catalog.messages[key], params, textLang);
}

const dateTime = (lang: string) =>
  new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

const clock = (lang: string) =>
  new Intl.DateTimeFormat(lang, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });

export function formatDateTime(value: number, lang: string = textLang): string {
  return dateTime(lang).format(value);
}

export function formatTime(value: number, lang: string = textLang): string {
  return clock(lang).format(value);
}
