// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { contrastRatio, filesOutsideBrand } from "../scripts/brand-check.mjs";
import { catalogProblems } from "../scripts/i18n-check.mjs";
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
  it("flags Hangul outside locale catalogs and exempts Korean copy", () => {
    expect(scanText("README.md", String.fromCodePoint(0xc0c1, 0xd0dc))).toEqual(
      ["README.md:1"],
    );
    expect(scanText("docs/guide.md", "English only")).toEqual([]);
    expect(exempt("locales/ko.json")).toBe(true);
    expect(exempt("locales/en.json")).toBe(false);
    expect(exempt("brand/copy/ko.json")).toBe(true);
    expect(exempt("brand/copy/en.json")).toBe(false);
    expect(exempt("README.ko.md")).toBe(true);
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

describe("i18n:check", () => {
  it("reports missing keys, extra keys, and placeholder drift", () => {
    const problems = catalogProblems(
      { hello: "Hello {name}", count: "{count, plural, one {#} other {#}}" },
      { hello: "Hello" },
      { ko: { hello: "Hello {name}", extra: "x" } },
    );
    expect(problems.some((problem) => problem.includes("missing count"))).toBe(
      true,
    );
    expect(problems.some((problem) => problem.includes("placeholders"))).toBe(
      true,
    );
    expect(problems.some((problem) => problem.includes("extra"))).toBe(true);
  });

  it("accepts the shipped catalogs", () => {
    const output = execFileSync("node", ["scripts/i18n-check.mjs"], {
      encoding: "utf8",
    });
    expect(output).toContain("i18n catalogs match");
  });
});
