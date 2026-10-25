// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { jsonValuesEqual, readJsonPath } from "./json-path";

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
