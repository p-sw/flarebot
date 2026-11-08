// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  jsonPathSyntaxError,
  jsonValuesEqual,
  readJsonPath,
} from "../../shared/json-path";

describe("readJsonPath", () => {
  const value = { status: "ok", items: [{ name: "api" }], "a.b": 1 };

  it("reads dotted and indexed paths", () => {
    expect(readJsonPath(value, "$.status")).toEqual({ ok: true, value: "ok" });
    expect(readJsonPath(value, "$.items[0].name")).toEqual({
      ok: true,
      value: "api",
    });
    expect(readJsonPath(value, "$['a.b']")).toEqual({ ok: true, value: 1 });
  });

  it("compares scalars and json text", () => {
    expect(jsonValuesEqual("ok", "ok")).toBe(true);
    expect(jsonValuesEqual(1, "1")).toBe(true);
    expect(jsonValuesEqual({ a: 1 }, '{"a":1}')).toBe(true);
  });
});

describe("jsonPathSyntaxError", () => {
  const supported = [
    "$",
    "$.status",
    "$.items[0].ok",
    "$['a.b']",
    '$["a b"]',
    "$.a_b.c-d",
    "  $.status  ",
  ];
  const unsupported = [
    "status",
    "",
    "   ",
    "$.",
    "$..status",
    "$.items[*]",
    "$.items[-1]",
    "$[?(@.ok)]",
    "$.@type",
    "$.status extra",
  ];

  it.each(supported)("accepts %j, which the check can read", (path) => {
    expect(jsonPathSyntaxError(path)).toBeNull();
    expect(readJsonPath({}, path)).not.toEqual({
      ok: false,
      error: "Unsupported JSON path syntax",
    });
  });

  it.each(unsupported)(
    "rejects %j, which the check would also reject",
    (path) => {
      const error = jsonPathSyntaxError(path);
      expect(error).not.toBeNull();
      const read = readJsonPath({ status: { extra: 1 } }, path);
      expect(read).toEqual({ ok: false, error });
    },
  );

  it("names a missing $ separately from other syntax", () => {
    expect(jsonPathSyntaxError("status")).toBe("JSON path must start with $");
    expect(jsonPathSyntaxError("   ")).toBe("JSON path must start with $");
    expect(jsonPathSyntaxError("$.")).toBe("Unsupported JSON path syntax");
  });
});
