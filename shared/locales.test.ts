// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { matchLocale } from "./locales";

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
