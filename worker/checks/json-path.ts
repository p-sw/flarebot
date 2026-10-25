// SPDX-License-Identifier: MIT

const TOKEN = /\.?([A-Za-z_][\w-]*)|\[(\d+)\]|\['([^']+)'\]|\["([^"]+)"\]/y;

/**
 * A small JSONPath subset: `$.a.b`, `$.items[0].ok`, `$['a']`.
 * Full JSONPath filters and wildcards are intentionally not supported.
 */
export function readJsonPath(
  value: unknown,
  path: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = path.trim();
  if (trimmed === "$") return { ok: true, value };
  if (!trimmed.startsWith("$"))
    return { ok: false, error: "JSON path must start with $" };
  TOKEN.lastIndex = 1;
  let current = value;
  while (TOKEN.lastIndex < trimmed.length) {
    const match = TOKEN.exec(trimmed);
    if (!match) return { ok: false, error: "Unsupported JSON path syntax" };
    const key = match[1] ?? match[3] ?? match[4];
    const index = match[2];
    if (index !== undefined) {
      if (!Array.isArray(current))
        return { ok: false, error: "Expected an array" };
      current = current[Number(index)];
    } else if (key !== undefined) {
      if (current === null || typeof current !== "object")
        return { ok: false, error: "Expected an object" };
      current = (current as Record<string, unknown>)[key];
    }
  }
  if (TOKEN.lastIndex !== trimmed.length)
    return { ok: false, error: "Unsupported JSON path syntax" };
  return { ok: true, value: current };
}

export function jsonValuesEqual(actual: unknown, expected: string): boolean {
  if (actual === undefined) return false;
  if (typeof actual === "string") return actual === expected;
  if (typeof actual === "number" || typeof actual === "boolean")
    return String(actual) === expected;
  if (actual === null) return expected === "null";
  return JSON.stringify(actual) === expected;
}
