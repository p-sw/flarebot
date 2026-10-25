// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { contrastRatio, filesOutsideBrand } from "../scripts/brand-check.mjs";
import {
  catalogProblems,
  hardcodedUi,
  placeholderNames,
  usedKeys,
} from "../scripts/copy-check.mjs";
import { exempt, scanText } from "../scripts/lint-lang.mjs";

describe("filesOutsideBrand", () => {
  it("ignores brand files and flags everything else", () => {
    const porcelain = [
      " M brand/tokens.css",
      " M .brand-preview/dashboard.png",
      " M src/pages/auth.tsx",
      "?? worker/app.ts",
    ].join("\n");
    expect(filesOutsideBrand(porcelain)).toEqual([
      "src/pages/auth.tsx",
      "worker/app.ts",
    ]);
    expect(filesOutsideBrand("")).toEqual([]);
  });
});

describe("contrastRatio", () => {
  it("is high for black on white and low for similar colors", () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeGreaterThan(20);
    expect(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBeLessThan(1.1);
  });
});

describe("lint:lang", () => {
  it("flags Hangul outside the brand locale file", () => {
    expect(scanText("README.md", String.fromCodePoint(0xc0c1, 0xd0dc))).toEqual(
      ["README.md:1"],
    );
    expect(scanText("docs/guide.md", "English only")).toEqual([]);
    expect(exempt("brand/locale.json")).toBe(true);
    expect(exempt("locales/ko.json")).toBe(false);
    expect(exempt("brand/copy/ko.json")).toBe(false);
    expect(exempt("README.ko.md")).toBe(false);
    expect(exempt("README.md")).toBe(false);
  });

  it("accepts the repository and rejects a Korean sentence", () => {
    execFileSync("node", ["scripts/lint-lang.mjs"], { stdio: "pipe" });
    const hangul = String.fromCodePoint(0xbab8, 0xb2c8, 0xd130);
    expect(() =>
      execFileSync("node", ["scripts/lint-lang.mjs", "--text", hangul], {
        stdio: "pipe",
      }),
    ).toThrow();
  });
});

describe("copy:check", () => {
  it("lists placeholders and flags a hardcoded label", () => {
    expect(
      placeholderNames("{count, plural, one {# monitor} other {# monitors}}"),
    ).toEqual(["count"]);
    expect(placeholderNames("{name} is down. Reason: {reason}")).toEqual([
      "name",
      "reason",
    ]);
    expect(
      hardcodedUi("src/pages/example.tsx", "<button>Save changes</button>"),
    ).toEqual(["src/pages/example.tsx has hardcoded UI text: Save changes"]);
  });

  it("reports a key that code uses but the catalog does not define", () => {
    const problems = catalogProblems(
      { lang: "en", messages: { hello: "Hello {name}" } },
      [],
    );
    expect(problems).toEqual([]);
    expect([...usedKeys('const label = t("missing_key");')]).toEqual([
      "missing_key",
    ]);
    const missing = catalogProblems({ lang: "en", messages: {} }, [
      "scripts/policy.test.ts",
    ]);
    expect(Array.isArray(missing)).toBe(true);
  });

  it("accepts the shipped locale file", () => {
    const output = execFileSync("node", ["scripts/copy-check.mjs"], {
      encoding: "utf8",
    });
    expect(output).toContain("copy catalog ok");
  });
});
