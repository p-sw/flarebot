// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { missingTranslationCount, pickLocalized } from "./content";

describe("pickLocalized", () => {
  it("falls back from the requested locale to the page default and then the source", () => {
    const result = pickLocalized(
      ["title", "description"],
      { title: "Source title", description: "Source description" },
      "ko",
      { en: { title: "Service status" } },
      "en",
      "ko",
    );
    expect(result.values.title).toBe("Service status");
    expect(result.langs.title).toBe("en");
    expect(result.values.description).toBe("Source description");
    expect(result.langs.description).toBe("ko");
  });

  it("counts empty translations without counting the source locale twice", () => {
    const missing = missingTranslationCount(
      ["title", "footer"],
      ["ko", "en"],
      "ko",
      { en: { title: "Status" } },
      { title: "Source title", footer: "Source footer" },
    );
    expect(missing).toBe(1);
  });
});
