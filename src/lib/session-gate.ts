// SPDX-License-Identifier: MIT

export type NavCause = "preload" | "enter" | "stay";

/**
 * Parent beforeLoad runs again on every child navigation.
 * A cached session lets that navigation skip the network.
 */
export function canReuseSession(cause: NavCause, user: unknown): boolean {
  return user != null && (cause === "stay" || cause === "preload");
}

let sessionEpoch = 0;

/** Cache key for the current sign-in. Logout advances the epoch so an in-flight read cannot restore the previous user. */
export function sessionCacheKey(): readonly ["session", number] {
  return ["session", sessionEpoch];
}

export function sessionCacheEpoch(): number {
  return sessionEpoch;
}

export function retireSessionCache(): number {
  sessionEpoch += 1;
  return sessionEpoch;
}
