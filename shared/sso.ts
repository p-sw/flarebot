// SPDX-License-Identifier: MIT

import { z } from "zod";
import { ROLES, type Role } from "./permissions";
import { isBlockedHost } from "./schemas";

export const ACCESS_PROVIDER_ID = "cloudflare-access";
export const SSO_POLICY_KEY = "sso_policy";
export const MAX_OIDC_PROVIDERS = 8;
export const OIDC_TRANSACTION_MS = 10 * 60_000;
export const CLOCK_SKEW_SEC = 60;

const claimName = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;

export const roleRuleSchema = z.object({
  kind: z.enum(["group", "email", "domain"]),
  value: z.string().trim().min(1).max(200),
  role: z.enum(ROLES),
});
export type RoleRule = z.infer<typeof roleRuleSchema>;

export const oidcMappingSchema = z.object({
  value: z.string().trim().min(1).max(200),
  role: z.enum(ROLES),
});
export type OidcMapping = z.infer<typeof oidcMappingSchema>;

export const providerInputSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().trim().min(1).max(80),
  buttonLabel: z.string().trim().min(1).max(80),
  issuerUrl: z.string().trim().min(8).max(500),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().max(500).optional(),
  clearClientSecret: z.boolean().optional(),
  scopes: z.string().trim().min(1).max(200),
  groupsClaim: z.string().trim().min(1).max(80),
  jitEnabled: z.boolean(),
  jitRole: z.enum(ROLES),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(20),
  roleMappings: z.array(oidcMappingSchema).max(20),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const accessConfigSchema = z.object({
  enabled: z.boolean(),
  teamName: z.string().max(253),
  audiences: z.array(z.string().trim().min(1).max(200)).max(10),
  groupsClaim: z.string().trim().min(1).max(80),
  jitEnabled: z.boolean(),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(20),
  rules: z.array(roleRuleSchema).max(30),
});
export type AccessConfig = z.infer<typeof accessConfigSchema>;

export const policySchema = z.object({
  hideLocalLogin: z.boolean(),
  access: accessConfigSchema,
});
export type SsoPolicy = z.infer<typeof policySchema>;

export const discoveryBodySchema = z.object({
  issuerUrl: z.string().trim().min(8).max(500),
});

export function defaultPolicy(): SsoPolicy {
  return {
    hideLocalLogin: false,
    access: {
      enabled: false,
      teamName: "",
      audiences: [],
      groupsClaim: "groups",
      jitEnabled: false,
      allowedDomains: [],
      rules: [],
    },
  };
}

export function parsePolicy(value: unknown): SsoPolicy {
  const parsed = policySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultPolicy();
}

export function publicHttpsUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (isBlockedHost(url.hostname)) return null;
  return url;
}

export function canonicalIssuer(value: string): string | null {
  const url = publicHttpsUrl(value);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function sameIssuer(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

export function discoveryUrls(issuer: string): string[] {
  const canonical = canonicalIssuer(issuer);
  if (!canonical) return [];
  const url = new URL(canonical);
  const path = url.pathname.replace(/\/+$/, "");
  const appended = new URL(url.origin);
  appended.pathname = `${path}/.well-known/openid-configuration`.replace(
    /\/{2,}/g,
    "/",
  );
  const inserted = new URL(url.origin);
  inserted.pathname = path
    ? `/.well-known/openid-configuration${path}`
    : "/.well-known/openid-configuration";
  const urls = [appended.toString()];
  if (inserted.toString() !== appended.toString())
    urls.push(inserted.toString());
  return urls;
}

export type DiscoveryDocument = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

export function parseDiscovery(
  body: unknown,
  expectedIssuer: string,
): DiscoveryDocument | null {
  if (!body || typeof body !== "object") return null;
  const doc = body as Record<string, unknown>;
  if (typeof doc.issuer !== "string" || !sameIssuer(doc.issuer, expectedIssuer))
    return null;
  const authorizationEndpoint =
    typeof doc.authorization_endpoint === "string"
      ? doc.authorization_endpoint
      : "";
  const tokenEndpoint =
    typeof doc.token_endpoint === "string" ? doc.token_endpoint : "";
  const jwksUri = typeof doc.jwks_uri === "string" ? doc.jwks_uri : "";
  if (
    !publicHttpsUrl(authorizationEndpoint) ||
    !publicHttpsUrl(tokenEndpoint) ||
    !publicHttpsUrl(jwksUri)
  ) {
    return null;
  }
  return {
    issuer: doc.issuer.replace(/\/+$/, ""),
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
  };
}

export function scopesIncludeOpenId(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes("openid");
}

export function validClaimName(value: string): boolean {
  return claimName.test(value);
}

export function normalizeDomain(value: string): string | null {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\.$/, "");
  if (!domain || domain.includes("..") || domain.includes("/")) return null;
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain,
    )
  ) {
    return null;
  }
  if (isBlockedHost(domain)) return null;
  return domain;
}

export function normalizeDomains(values: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const value of values) {
    const domain = normalizeDomain(value);
    if (!domain) return null;
    if (!out.includes(domain)) out.push(domain);
  }
  return out;
}

export function emailDomainAllowed(
  email: string,
  domains: readonly string[],
): boolean {
  if (domains.length === 0) return true;
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return domains.some(
    (item) => item.toLowerCase().replace(/^@/, "") === domain,
  );
}

export function stringList(value: unknown, limit = 50): string[] {
  const raw =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 200) continue;
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

export function claimValue(
  payload: Record<string, unknown>,
  name: string,
): unknown {
  if (!Object.hasOwn(payload, name)) return undefined;
  return payload[name];
}

export function matchMappedRole(
  mappings: readonly OidcMapping[],
  groups: readonly string[],
): Role | null {
  for (const mapping of mappings) {
    if (groups.includes(mapping.value)) return mapping.role;
  }
  return null;
}

export function matchAccessRule(
  rules: readonly RoleRule[],
  email: string,
  groups: readonly string[],
): Role | null {
  const normalized = email.toLowerCase();
  const domain = normalized.split("@")[1] ?? "";
  for (const rule of rules) {
    if (rule.kind === "group" && groups.includes(rule.value)) return rule.role;
    if (rule.kind === "email" && normalized === rule.value.toLowerCase())
      return rule.role;
    if (
      rule.kind === "domain" &&
      domain === rule.value.toLowerCase().replace(/^@/, "")
    ) {
      return rule.role;
    }
  }
  return null;
}

export function accessTeamHost(teamName: string): string | null {
  const trimmed = teamName
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!trimmed || trimmed.includes("..") || trimmed.includes("@")) return null;
  const host = trimmed.endsWith(".cloudflareaccess.com")
    ? trimmed
    : `${trimmed}.cloudflareaccess.com`;
  const suffix = ".cloudflareaccess.com";
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  return host;
}

export function accessIssuer(host: string): string {
  return `https://${host}`;
}

export function accessCertsUrl(host: string): string {
  return `https://${host}/cdn-cgi/access/certs`;
}

export function accessIdentityUrl(host: string): string {
  return `https://${host}/cdn-cgi/access/get-identity`;
}

export function audienceIncludes(
  aud: unknown,
  expected: readonly string[],
): boolean {
  const values =
    typeof aud === "string"
      ? [aud]
      : Array.isArray(aud)
        ? aud.filter((item): item is string => typeof item === "string")
        : [];
  return expected.some((item) => values.includes(item));
}

export function audienceMatchesClient(
  aud: unknown,
  clientId: string,
  azp: unknown,
): boolean {
  const values =
    typeof aud === "string"
      ? [aud]
      : Array.isArray(aud)
        ? aud.filter((item): item is string => typeof item === "string")
        : [];
  if (!values.includes(clientId)) return false;
  if (values.length > 1 && azp !== clientId) return false;
  return true;
}

export function timeClaimsOk(
  payload: Record<string, unknown>,
  nowMs: number,
): boolean {
  const now = Math.floor(nowMs / 1000);
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
  if (exp + CLOCK_SKEW_SEC < now) return false;
  const nbf = payload.nbf;
  if (
    nbf !== undefined &&
    (typeof nbf !== "number" || nbf - CLOCK_SKEW_SEC > now)
  )
    return false;
  const iat = payload.iat;
  if (
    iat !== undefined &&
    (typeof iat !== "number" || iat > now + CLOCK_SKEW_SEC)
  )
    return false;
  return true;
}

function verifiedFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function verifiedEmail(payload: Record<string, unknown>): string | null {
  const verified =
    verifiedFlag(claimValue(payload, "email_verified")) ||
    verifiedFlag(claimValue(payload, "xms_edov"));
  if (!verified) return null;
  const email = claimValue(payload, "email");
  const preferred = claimValue(payload, "preferred_username");
  const candidate =
    typeof email === "string"
      ? email
      : typeof preferred === "string" && preferred.includes("@")
        ? preferred
        : "";
  const normalized = candidate.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function accountName(
  payload: Record<string, unknown>,
  email: string,
): string {
  const name = claimValue(payload, "name");
  if (typeof name === "string" && name.trim()) return name.trim().slice(0, 80);
  const given =
    typeof claimValue(payload, "given_name") === "string"
      ? String(claimValue(payload, "given_name"))
      : "";
  const family =
    typeof claimValue(payload, "family_name") === "string"
      ? String(claimValue(payload, "family_name"))
      : "";
  const joined = `${given} ${family}`.trim();
  if (joined) return joined.slice(0, 80);
  return email.slice(0, 80);
}

export type OidcClaims = {
  email: string;
  name: string;
  subject: string;
  groups: string[];
};

export function validateOidcClaims(
  payload: Record<string, unknown>,
  options: {
    issuer: string;
    audience: string;
    nonce: string;
    groupsClaim: string;
    nowMs: number;
  },
): { ok: true; claims: OidcClaims } | { ok: false; reason: "email" | "token" } {
  const iss = claimValue(payload, "iss");
  if (typeof iss !== "string" || !sameIssuer(iss, options.issuer))
    return { ok: false, reason: "token" };
  if (
    !audienceMatchesClient(
      claimValue(payload, "aud"),
      options.audience,
      claimValue(payload, "azp"),
    )
  ) {
    return { ok: false, reason: "token" };
  }
  if (!timeClaimsOk(payload, options.nowMs))
    return { ok: false, reason: "token" };
  const nonce = claimValue(payload, "nonce");
  if (typeof nonce !== "string" || nonce !== options.nonce)
    return { ok: false, reason: "token" };
  const subject = claimValue(payload, "sub");
  if (typeof subject !== "string" || !subject.trim() || subject.length > 500)
    return { ok: false, reason: "token" };
  const email = verifiedEmail(payload);
  if (!email) return { ok: false, reason: "email" };
  return {
    ok: true,
    claims: {
      email,
      name: accountName(payload, email),
      subject: subject.trim(),
      groups: stringList(claimValue(payload, options.groupsClaim)),
    },
  };
}
