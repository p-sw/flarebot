// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { matchLocale, resolveRequestedLocale } from "./locales";

describe("matchLocale", () => {
  it("maps a regional tag onto the page language", () => {
    expect(matchLocale("ko-KR,ko;q=0.9,en;q=0.8", ["en", "ko"], "en")).toEqual({
      locale: "ko",
      fromHeader: true,
    });
  });

  it("uses the fallback when nothing matches", () => {
    expect(matchLocale("ja,fr;q=0.5", ["en", "ko"], "en").locale).toBe("en");
  });
});

describe("resolveRequestedLocale", () => {
  const available = ["en", "ko"];

  it("lets an explicit query win over the cookie and Accept-Language", () => {
    expect(
      resolveRequestedLocale(available, "en", {
        query: "ko",
        cookie: "en",
        acceptLanguage: "en",
      }),
    ).toEqual({ locale: "ko", source: "query" });
  });

  it("lets a saved cookie win over Accept-Language", () => {
    expect(
      resolveRequestedLocale(available, "en", {
        cookie: "en",
        acceptLanguage: "ko-KR,ko;q=0.9",
      }),
    ).toEqual({ locale: "en", source: "cookie" });
  });

  it("ignores a cookie that the page does not offer", () => {
    expect(
      resolveRequestedLocale(["en"], "en", {
        cookie: "ko",
        acceptLanguage: "en",
      }).source,
    ).toBe("header");
  });
});
