// SPDX-License-Identifier: MIT

const RETURN_BASE = "https://return-path.invalid";

const LEGACY_ROOTS = new Set([
  "monitors",
  "status-pages",
  "channels",
  "team",
  "tokens",
  "audit",
  "settings",
  "account",
]);

export function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/"))
    return pathname.replace(/\/+$/, "") || "/";
  return pathname;
}

export function legacyConsoleLocation(
  pathname: string,
  search = "",
): string | null {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split("/").filter(Boolean);
  const head = segments[0];
  if (!head || !LEGACY_ROOTS.has(head)) return null;
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  return `/console/${segments.join("/")}${query}`;
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

// Same-origin relative paths only. Rejects scheme, protocol-relative, and
// backslash forms that browsers may treat as a different host.
export function safeReturnPath(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  if (trimmed.includes("\\") || hasControlChar(trimmed)) return null;
  // Query decoding turns %2F into /. A second decode of a leftover %2F would
  // make a protocol-relative URL, so reject encoded slashes and backslashes.
  if (/%2f|%5c/i.test(trimmed)) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(trimmed, RETURN_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_BASE) return null;
  if (url.username || url.password) return null;
  const combined = `${url.pathname}${url.search}${url.hash}`;
  if (hasControlChar(combined) || combined.includes("\\")) return null;
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//"))
    return null;
  return combined;
}

export type FrontDecision =
  | { type: "redirect"; location: string }
  | { type: "public-root" }
  | { type: "spa" }
  | { type: "ignore" };

export function decideFrontDoor(input: {
  pathname: string;
  search: string;
  setupRequired: boolean;
  authenticated: boolean;
  rootAvailable: boolean;
}): FrontDecision {
  const pathname = normalizePathname(input.pathname);
  const legacy = legacyConsoleLocation(pathname, input.search);
  if (legacy) return { type: "redirect", location: legacy };

  if (pathname === "/setup") {
    if (!input.setupRequired) return { type: "redirect", location: "/login" };
    return { type: "spa" };
  }
  if (pathname === "/login") {
    if (input.setupRequired) return { type: "redirect", location: "/setup" };
    if (input.authenticated) return { type: "redirect", location: "/console" };
    return { type: "spa" };
  }
  if (pathname === "/console" || pathname.startsWith("/console/")) {
    if (input.setupRequired) return { type: "redirect", location: "/setup" };
    if (!input.authenticated) {
      const next = safeReturnPath(`${pathname}${input.search}`) ?? "/console";
      return {
        type: "redirect",
        location: `/login?next=${encodeURIComponent(next)}`,
      };
    }
    return { type: "spa" };
  }
  if (pathname === "/") {
    if (input.rootAvailable) return { type: "public-root" };
    return { type: "redirect", location: "/login" };
  }
  return { type: "ignore" };
}
