// SPDX-License-Identifier: MIT

import { and, eq } from "drizzle-orm";
import { isRole } from "../../shared/permissions";
import {
  claimValue,
  type DiscoveryDocument,
  discoveryUrls,
  matchMappedRole,
  OIDC_TRANSACTION_MS,
  type OidcMapping,
  parseDiscovery,
  validateOidcClaims,
} from "../../shared/sso";
import {
  bytesToB64Url,
  decryptString,
  encryptString,
  requireEncryptionKey,
  sha256Hex,
  timingSafeEqual,
} from "../crypto/secret";
import { getDb } from "../db/client";
import { oidcTransactions, ssoProviders } from "../db/schema";
import { SsoFlowError } from "./errors";
import { verifyAgainstUrl } from "./jwt";
import { linkSsoAccount } from "./link";

const DISCOVERY_TTL_MS = 60 * 60_000;

export type ProviderRow = typeof ssoProviders.$inferSelect;

export function randomUrlToken(): string {
  return bytesToB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToB64Url(new Uint8Array(digest));
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new SsoFlowError("config");
  }
  if (!response.ok) throw new SsoFlowError("config");
  const text = await response.text();
  if (text.length > 65_536) throw new SsoFlowError("config");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SsoFlowError("config");
  }
}

export async function fetchDiscovery(
  issuer: string,
): Promise<DiscoveryDocument> {
  const urls = discoveryUrls(issuer);
  if (urls.length === 0) throw new SsoFlowError("config");
  let mismatch = false;
  for (const url of urls) {
    try {
      const body = await fetchJson(url);
      const parsed = parseDiscovery(body, issuer);
      if (parsed) return parsed;
      mismatch = true;
    } catch (error) {
      if (error instanceof SsoFlowError) continue;
      throw error;
    }
  }
  throw new SsoFlowError(mismatch ? "token" : "config");
}

export function authorizeUrl(
  discovery: DiscoveryDocument,
  params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  },
): string {
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function loadProviderDiscovery(
  env: Env,
  provider: ProviderRow,
): Promise<DiscoveryDocument> {
  const now = Date.now();
  if (
    provider.discoveryJson &&
    provider.discoveryAt &&
    now - provider.discoveryAt < DISCOVERY_TTL_MS
  ) {
    try {
      const parsed = JSON.parse(provider.discoveryJson) as DiscoveryDocument;
      if (
        parsed.authorizationEndpoint &&
        parsed.tokenEndpoint &&
        parsed.jwksUri &&
        parsed.issuer
      ) {
        return parsed;
      }
    } catch {
      // The stored document is replaced below.
    }
  }
  const doc = await fetchDiscovery(provider.issuerUrl);
  await getDb(env.DB)
    .update(ssoProviders)
    .set({ discoveryJson: JSON.stringify(doc), discoveryAt: now })
    .where(eq(ssoProviders.id, provider.id));
  return doc;
}

export async function beginOidcLogin(
  env: Env,
  provider: ProviderRow,
  redirectUri: string,
): Promise<{ url: string; state: string }> {
  const discovery = await loadProviderDiscovery(env, provider);
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const verifier = randomUrlToken();
  const now = Date.now();
  await env.DB.prepare("DELETE FROM oidc_transactions WHERE expires_at <= ?")
    .bind(now)
    .run();
  await getDb(env.DB)
    .insert(oidcTransactions)
    .values({
      id: crypto.randomUUID(),
      providerId: provider.id,
      stateHash: await sha256Hex(state),
      nonceHash: await sha256Hex(nonce),
      codeVerifierEncrypted: await encryptString(
        requireEncryptionKey(env),
        verifier,
      ),
      redirectUri,
      expiresAt: now + OIDC_TRANSACTION_MS,
      createdAt: now,
    });
  return {
    state,
    url: authorizeUrl(discovery, {
      clientId: provider.clientId,
      redirectUri,
      scope: provider.scopes,
      state,
      nonce,
      codeChallenge: await codeChallenge(verifier),
    }),
  };
}

type Consumed = {
  providerId: string;
  nonceHash: string;
  codeVerifier: string;
  redirectUri: string;
};

export async function consumeOidcTransaction(
  env: Env,
  state: string,
): Promise<Consumed | null> {
  const db = getDb(env.DB);
  const stateHash = await sha256Hex(state);
  const row = await db
    .select()
    .from(oidcTransactions)
    .where(eq(oidcTransactions.stateHash, stateHash))
    .get();
  if (!row || row.expiresAt <= Date.now()) return null;
  const deleted = await env.DB.prepare(
    "DELETE FROM oidc_transactions WHERE id = ? AND expires_at > ?",
  )
    .bind(row.id, Date.now())
    .run();
  if (!deleted.meta.changes) return null;
  return {
    providerId: row.providerId,
    nonceHash: row.nonceHash,
    codeVerifier: await decryptString(
      requireEncryptionKey(env),
      row.codeVerifierEncrypted,
    ),
    redirectUri: row.redirectUri,
  };
}

async function exchangeCode(
  discovery: DiscoveryDocument,
  provider: ProviderRow,
  code: string,
  redirectUri: string,
  verifier: string,
  env: Env,
): Promise<string> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", provider.clientId);
  body.set("code_verifier", verifier);
  if (provider.clientSecretEncrypted) {
    body.set(
      "client_secret",
      await decryptString(
        requireEncryptionKey(env),
        provider.clientSecretEncrypted,
      ),
    );
  }
  const payload = await fetchJson(discovery.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!payload || typeof payload !== "object") throw new SsoFlowError("token");
  const idToken = (payload as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string" || !idToken) throw new SsoFlowError("token");
  return idToken;
}

function mappingsOf(provider: ProviderRow): OidcMapping[] {
  try {
    const parsed = JSON.parse(provider.roleMappingsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OidcMapping =>
        !!item &&
        typeof item === "object" &&
        typeof (item as OidcMapping).value === "string" &&
        isRole((item as OidcMapping).role),
    );
  } catch {
    return [];
  }
}

function domainsOf(provider: ProviderRow): string[] {
  try {
    const parsed = JSON.parse(provider.allowedDomainsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function finishOidcLogin(
  env: Env,
  transaction: Consumed,
  code: string,
  ip: string | null,
): Promise<{ userId: string; created: boolean; email: string }> {
  const provider = await getDb(env.DB)
    .select()
    .from(ssoProviders)
    .where(
      and(
        eq(ssoProviders.id, transaction.providerId),
        eq(ssoProviders.enabled, true),
      ),
    )
    .get();
  if (!provider) throw new SsoFlowError("config");
  const discovery = await loadProviderDiscovery(env, provider);
  const idToken = await exchangeCode(
    discovery,
    provider,
    code,
    transaction.redirectUri,
    transaction.codeVerifier,
    env,
  );
  const payload = await verifyAgainstUrl(env, idToken, discovery.jwksUri);
  const nonce = claimValue(payload, "nonce");
  if (typeof nonce !== "string") throw new SsoFlowError("token");
  if (!timingSafeEqual(await sha256Hex(nonce), transaction.nonceHash)) {
    throw new SsoFlowError("token");
  }
  const validated = validateOidcClaims(payload, {
    issuer: discovery.issuer,
    audience: provider.clientId,
    nonce,
    groupsClaim: provider.groupsClaim,
    nowMs: Date.now(),
  });
  if (!validated.ok) throw new SsoFlowError(validated.reason);
  const mappings = mappingsOf(provider);
  const mappedRole = matchMappedRole(mappings, validated.claims.groups);
  if (!isRole(provider.jitRole)) throw new SsoFlowError("config");
  return linkSsoAccount(env, {
    providerId: provider.id,
    subject: validated.claims.subject,
    email: validated.claims.email,
    name: validated.claims.name,
    mappedRole,
    jitEnabled: provider.jitEnabled,
    jitRole: provider.jitRole,
    allowedDomains: domainsOf(provider),
    ip,
  });
}
