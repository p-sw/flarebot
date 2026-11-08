// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { HttpDegradedConfig } from "../../shared/schemas";
import { degradedReason, evaluateHttp } from "./evaluate";

const passing = {
  status: 200,
  body: JSON.stringify({ status: "degraded", ok: true, count: 3 }),
  responseMs: 120,
  expectedStatuses: [200],
};

function degraded(config: Partial<HttpDegradedConfig>): HttpDegradedConfig {
  return { keywordMode: "present", notify: true, ...config };
}

describe("degraded keyword condition", () => {
  it.each([
    ["present", "degraded", "Degraded keyword was found"],
    ["present", "maintenance", null],
    ["absent", "healthy", "Degraded keyword was not found"],
    ["absent", "degraded", null],
  ] as const)("keyword mode %s with %j gives %j", (mode, keyword, reason) => {
    expect(
      degradedReason(
        degraded({ keyword, keywordMode: mode }),
        passing.body,
        passing.responseMs,
      ),
    ).toBe(reason);
  });

  it.each([
    ["present", "too slow now", "Degraded keyword was found"],
    ["present", "too slow.", null],
    ["absent", "too slow.", "Degraded keyword was not found"],
    ["absent", "too slow now", null],
  ] as const)(
    "matches the keyword %s with its trailing space in %j",
    (mode, body, reason) => {
      expect(
        degradedReason(
          degraded({ keyword: "slow ", keywordMode: mode }),
          body,
          1,
        ),
      ).toBe(reason);
    },
  );

  it.each(["present", "absent"] as const)(
    "treats an empty %s keyword as no condition",
    (mode) => {
      expect(
        degradedReason(degraded({ keyword: "", keywordMode: mode }), "any", 1),
      ).toBeNull();
    },
  );

  it("treats a missing keyword mode as present", () => {
    const config = { keyword: "degraded", notify: true } as HttpDegradedConfig;
    expect(degradedReason(config, passing.body, 1)).toBe(
      "Degraded keyword was found",
    );
  });
});

describe("degraded JSON condition", () => {
  it.each([
    ["$.status", "degraded", "Degraded JSON value matched"],
    ["$.status", "ok", null],
    ["$.ok", "true", "Degraded JSON value matched"],
    ["$.count", "3", "Degraded JSON value matched"],
    ["$.missing", "degraded", null],
    ["$.status.inner", "degraded", null],
  ] as const)(
    "path %s expecting %j gives %j",
    (jsonPath, jsonExpect, reason) => {
      expect(
        degradedReason(
          degraded({ jsonPath, jsonExpect }),
          passing.body,
          passing.responseMs,
        ),
      ).toBe(reason);
    },
  );

  it("does not match a body that is not JSON", () => {
    expect(
      degradedReason(
        degraded({ jsonPath: "$.status", jsonExpect: "degraded" }),
        "status: degraded",
        1,
      ),
    ).toBeNull();
  });

  it("matches an empty expected value only against an empty string", () => {
    const config = degraded({ jsonPath: "$.note", jsonExpect: "" });
    expect(degradedReason(config, '{"note":""}', 1)).toBe(
      "Degraded JSON value matched",
    );
    expect(degradedReason(config, '{"note":"x"}', 1)).toBeNull();
    expect(degradedReason(config, "{}", 1)).toBeNull();
  });

  it("ignores a path without an expected value", () => {
    expect(
      degradedReason(degraded({ jsonPath: "$.status" }), passing.body, 1),
    ).toBeNull();
  });
});

describe("degraded response time condition", () => {
  it.each([
    [499, null],
    [500, null],
    [501, "Response time was over the degraded limit"],
  ])("a %i ms response with a 500 ms limit gives %j", (ms, reason) => {
    expect(
      degradedReason(degraded({ maxResponseMs: 500 }), passing.body, ms),
    ).toBe(reason);
  });
});

describe("combined degraded conditions", () => {
  it("is not degraded when no condition is set", () => {
    expect(degradedReason(degraded({}), passing.body, 30_000)).toBeNull();
  });

  it("is degraded when any one condition matches", () => {
    const config = degraded({
      keyword: "never-there",
      jsonPath: "$.status",
      jsonExpect: "ok",
      maxResponseMs: 100,
    });
    expect(degradedReason(config, passing.body, 101)).toBe(
      "Response time was over the degraded limit",
    );
    expect(degradedReason(config, passing.body, 100)).toBeNull();
  });

  it("reports the keyword first, then JSON, then response time", () => {
    const all = degraded({
      keyword: "degraded",
      jsonPath: "$.status",
      jsonExpect: "degraded",
      maxResponseMs: 1,
    });
    expect(degradedReason(all, passing.body, 50)).toBe(
      "Degraded keyword was found",
    );
    expect(
      degradedReason({ ...all, keyword: undefined }, passing.body, 50),
    ).toBe("Degraded JSON value matched");
  });
});

describe("evaluateHttp with degraded conditions", () => {
  const always = degraded({ maxResponseMs: 1, keyword: "degraded" });

  it("marks a passing check degraded and keeps it ok", () => {
    const outcome = evaluateHttp({ ...passing, degraded: always });
    expect(outcome.ok).toBe(true);
    expect(outcome.error).toBeNull();
    expect(outcome.degraded).toBe("Degraded keyword was found");
  });

  it("leaves a passing check without a degraded block unmarked", () => {
    const outcome = evaluateHttp(passing);
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBeUndefined();
  });

  it("returns null when conditions are set but none match", () => {
    const outcome = evaluateHttp({
      ...passing,
      degraded: degraded({ keyword: "never-there", maxResponseMs: 10_000 }),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.degraded).toBeNull();
  });

  it.each([
    ["an unexpected status", { status: 503 }, "status"],
    ["a missing keyword", { keyword: "ready" }, "keyword"],
    [
      "a forbidden keyword",
      { keyword: "degraded", keywordMode: "absent" as const },
      "keyword",
    ],
    ["a JSON mismatch", { jsonPath: "$.ok", jsonExpect: "false" }, "json"],
    ["a body that is not JSON", { body: "<html>", jsonPath: "$.ok" }, "json"],
  ])(
    "does not evaluate degraded conditions after %s",
    (_label, extra, kind) => {
      const outcome = evaluateHttp({ ...passing, ...extra, degraded: always });
      expect(outcome.ok).toBe(false);
      expect(outcome.errorKind).toBe(kind);
      expect(outcome.degraded).toBeUndefined();
    },
  );
});

describe("health JSON path behavior", () => {
  it.each([
    ["$.status", "degraded", true, null],
    ["$.status", "ok", false, "JSON value did not match"],
    ["status", "degraded", false, "JSON path must start with $"],
    ["$.items[*]", "x", false, "Unsupported JSON path syntax"],
    ["$.status[0]", "x", false, "Expected an array"],
  ])(
    "path %s expecting %j passes=%s with error %j",
    (jsonPath, jsonExpect, ok, error) => {
      const outcome = evaluateHttp({ ...passing, jsonPath, jsonExpect });
      expect(outcome.ok).toBe(ok);
      expect(outcome.error).toBe(error);
    },
  );

  it("checks only that a health path resolves when no value is expected", () => {
    expect(evaluateHttp({ ...passing, jsonPath: "$.missing" }).ok).toBe(true);
    expect(
      evaluateHttp({ ...passing, jsonPath: "$.status.inner.deep" }).error,
    ).toBe("Expected an object");
  });
});
