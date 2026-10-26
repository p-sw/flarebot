// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import { b64ToBytes } from "../crypto/secret";
import { getDb } from "../db/client";
import { ssoJwksCache } from "../db/schema";
import { SsoFlowError } from "./errors";

const MEMORY_TTL_MS = 10 * 60_000;
const FRESH_TTL_MS = 60 * 60_000;
const STALE_TTL_MS = 24 * 60 * 60_000;
const MAX_TOKEN_CHARS = 16_000;
const MAX_JWKS_CHARS = 65_536;

type JwtReason = "malformed" | "algorithm" | "kid" | "signature";

export type Jwk = {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
};

type MemoryEntry = { body: string; at: number };
const memory = new Map<string, MemoryEntry>();

export function clearJwksCache(): void {
  memory.clear();
}

function b64urlToBytes(value: string): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4;
  const base64 = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(pad)}`;
  return b64ToBytes(base64);
}

function decodeJson(segment: string): Record<string, unknown> {
  const text = new TextDecoder().decode(b64urlToBytes(segment));
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("shape");
  }
  return value as Record<string, unknown>;
}

function publicJwk(alg: string, key: Jwk): Record<string, string> | null {
  if (alg === "RS256") {
    if (key.kty !== "RSA" || !key.n || !key.e) return null;
    return { kty: "RSA", n: key.n, e: key.e };
  }
  if (key.kty !== "EC" || !key.x || !key.y) return null;
  if (key.crv && key.crv !== "P-256") return null;
  return { kty: "EC", crv: "P-256", x: key.x, y: key.y };
}

async function verifyOne(
  alg: string,
  key: Jwk,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const jwk = publicJwk(alg, key);
  if (!jwk) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk as unknown as JsonWebKey,
      alg === "RS256"
        ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
        : { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const algorithm =
      alg === "RS256"
        ? { name: "RSASSA-PKCS1-v1_5" }
        : { name: "ECDSA", hash: "SHA-256" };
    return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}

export function parseJwks(body: string): { keys: Jwk[] } {
  if (body.length > MAX_JWKS_CHARS) throw new SsoFlowError("config");
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SsoFlowError("token");
  }
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) throw new SsoFlowError("token");
  return {
    keys: keys
      .filter((key) => key && typeof key === "object")
      .slice(0, 8) as Jwk[],
  };
}

export async function verifyJwt(
  token: string,
  jwks: { keys: Jwk[] },
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: JwtReason }
> {
  if (!token || token.length > MAX_TOKEN_CHARS)
    return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { ok: false, reason: "malformed" };
  }
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
    signature = b64urlToBytes(encodedSignature);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const alg = header.alg;
  if (alg !== "RS256" && alg !== "ES256")
    return { ok: false, reason: "algorithm" };
  if (alg === "ES256" && signature.byteLength !== 64) {
    return { ok: false, reason: "signature" };
  }
  const kid = typeof header.kid === "string" ? header.kid : "";
  const candidates = jwks.keys
    .filter((key) => {
      if (key.use && key.use !== "sig") return false;
      if (key.alg && key.alg !== alg) return false;
      if (kid && key.kid !== kid) return false;
      return publicJwk(alg, key) !== null;
    })
    .slice(0, 4);
  if (candidates.length === 0)
    return { ok: false, reason: kid ? "kid" : "signature" };
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  for (const key of candidates) {
    if (await verifyOne(alg, key, signature, data))
      return { ok: true, payload };
  }
  return { ok: false, reason: "signature" };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "application/json" },
  });
  if (response.status >= 300 && response.status < 400)
    throw new SsoFlowError("config");
  if (!response.ok) throw new SsoFlowError("config");
  const text = await response.text();
  if (text.length > MAX_JWKS_CHARS) throw new SsoFlowError("config");
  return text;
}

export async function loadJwks(
  env: Env,
  url: string,
  force = false,
): Promise<{ keys: Jwk[] }> {
  const now = Date.now();
  if (!force) {
    const hit = memory.get(url);
    if (hit && now - hit.at < MEMORY_TTL_MS) return parseJwks(hit.body);
    const row = await getDb(env.DB)
      .select()
      .from(ssoJwksCache)
      .where(eq(ssoJwksCache.url, url))
      .get();
    if (row && now - row.fetchedAt < FRESH_TTL_MS) {
      memory.set(url, { body: row.body, at: now });
      return parseJwks(row.body);
    }
  }
  try {
    const body = await fetchText(url);
    const parsed = parseJwks(body);
    memory.set(url, { body, at: now });
    await getDb(env.DB)
      .insert(ssoJwksCache)
      .values({ url, body, fetchedAt: now })
      .onConflictDoUpdate({
        target: ssoJwksCache.url,
        set: { body, fetchedAt: now },
      });
    return parsed;
  } catch (error) {
    if (force) throw error;
    const row = await getDb(env.DB)
      .select()
      .from(ssoJwksCache)
      .where(eq(ssoJwksCache.url, url))
      .get();
    if (row && now - row.fetchedAt < STALE_TTL_MS) {
      memory.set(url, { body: row.body, at: now });
      return parseJwks(row.body);
    }
    throw error instanceof SsoFlowError ? error : new SsoFlowError("config");
  }
}

export async function verifyAgainstUrl(
  env: Env,
  token: string,
  jwksUrl: string,
): Promise<Record<string, unknown>> {
  let jwks = await loadJwks(env, jwksUrl, false);
  let result = await verifyJwt(token, jwks);
  if (!result.ok && result.reason === "kid") {
    jwks = await loadJwks(env, jwksUrl, true);
    result = await verifyJwt(token, jwks);
  }
  if (!result.ok) throw new SsoFlowError("token");
  return result.payload;
}
