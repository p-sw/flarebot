// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  accessTeamHost,
  audienceIncludes,
  audienceMatchesClient,
  canonicalIssuer,
  discoveryUrls,
  emailDomainAllowed,
  matchAccessRule,
  matchMappedRole,
  normalizeDomains,
  parseDiscovery,
  sameIssuer,
  scopesIncludeOpenId,
  timeClaimsOk,
  validateOidcClaims,
  verifiedEmail,
} from "./sso";

describe("openid connect helpers", () => {
  it("builds the appended discovery URL and the path-inserted fallback", () => {
    expect(
      discoveryUrls("https://idp.example.com/application/o/flarebot/"),
    ).toEqual([
      "https://idp.example.com/application/o/flarebot/.well-known/openid-configuration",
      "https://idp.example.com/.well-known/openid-configuration/application/o/flarebot",
    ]);
    expect(discoveryUrls("https://accounts.example.com")).toEqual([
      "https://accounts.example.com/.well-known/openid-configuration",
    ]);
    expect(canonicalIssuer("http://idp.example.com")).toBeNull();
    expect(canonicalIssuer("https://127.0.0.1/realms/app")).toBeNull();
  });

  it("accepts a discovery document only when the issuer and endpoints match", () => {
    const issuer = "https://idp.example.com/realms/app";
    expect(
      parseDiscovery(
        {
          issuer: `${issuer}/`,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/certs`,
        },
        issuer,
      )?.issuer,
    ).toBe(issuer);
    expect(sameIssuer(`${issuer}/`, issuer)).toBe(true);
    expect(
      parseDiscovery(
        {
          issuer: "https://other.example.com",
          authorization_endpoint: "https://other.example.com/auth",
          token_endpoint: "https://other.example.com/token",
          jwks_uri: "https://other.example.com/certs",
        },
        issuer,
      ),
    ).toBeNull();
  });

  it("requires openid, a verified email, and exact group rules", () => {
    expect(scopesIncludeOpenId("openid email profile")).toBe(true);
    expect(scopesIncludeOpenId("email profile")).toBe(false);
    expect(
      verifiedEmail({ email: "Ada@Example.com", email_verified: true }),
    ).toBe("ada@example.com");
    expect(
      verifiedEmail({ email: "ada@example.com", email_verified: false }),
    ).toBeNull();
    expect(
      verifiedEmail({
        preferred_username: "ada@example.com",
        xms_edov: "1",
      }),
    ).toBe("ada@example.com");
    expect(
      matchMappedRole(
        [{ value: "admins", role: "admin" }],
        ["users", "admins"],
      ),
    ).toBe("admin");
    expect(
      matchMappedRole([{ value: "admins", role: "admin" }], ["Admins"]),
    ).toBeNull();
    expect(normalizeDomains(["Example.com", "@example.com"])).toEqual([
      "example.com",
    ]);
    expect(normalizeDomains(["localhost"])).toBeNull();
    expect(emailDomainAllowed("ada@example.com", [])).toBe(true);
    expect(emailDomainAllowed("ada@other.com", ["example.com"])).toBe(false);
  });

  it("checks issuer, audience, expiry, and nonce on an ID token", () => {
    const now = 1_700_000_000_000;
    const payload = {
      iss: "https://idp.example.com",
      aud: "client",
      exp: 1_700_000_000 + 300,
      iat: 1_700_000_000,
      nonce: "nonce-1",
      sub: "subject",
      email: "ada@example.com",
      email_verified: true,
      groups: ["editors"],
    };
    const ok = validateOidcClaims(payload, {
      issuer: "https://idp.example.com",
      audience: "client",
      nonce: "nonce-1",
      groupsClaim: "groups",
      nowMs: now,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.claims.groups).toEqual(["editors"]);
    expect(
      validateOidcClaims(
        { ...payload, nonce: "other" },
        {
          issuer: "https://idp.example.com",
          audience: "client",
          nonce: "nonce-1",
          groupsClaim: "groups",
          nowMs: now,
        },
      ),
    ).toEqual({ ok: false, reason: "token" });
    expect(
      validateOidcClaims(
        { ...payload, exp: 1_700_000_000 - 120 },
        {
          issuer: "https://idp.example.com",
          audience: "client",
          nonce: "nonce-1",
          groupsClaim: "groups",
          nowMs: now,
        },
      ).ok,
    ).toBe(false);
    expect(timeClaimsOk({ exp: 10 }, 20_000)).toBe(true);
    expect(timeClaimsOk({ exp: 10 }, 80_000)).toBe(false);
    expect(audienceMatchesClient(["client", "other"], "client", "client")).toBe(
      true,
    );
    expect(audienceMatchesClient(["client", "other"], "client", "nope")).toBe(
      false,
    );
  });
});

describe("cloudflare access helpers", () => {
  it("normalizes a team name and matches email, domain, and group rules", () => {
    expect(accessTeamHost("MyTeam")).toBe("myteam.cloudflareaccess.com");
    expect(accessTeamHost("https://myteam.cloudflareaccess.com/")).toBe(
      "myteam.cloudflareaccess.com",
    );
    expect(accessTeamHost("evil.com")).toBeNull();
    expect(audienceIncludes(["aud-1", "aud-2"], ["aud-2"])).toBe(true);
    expect(audienceIncludes("aud-1", ["aud-2"])).toBe(false);
    expect(
      matchAccessRule(
        [
          { kind: "group", value: "owners", role: "owner" },
          { kind: "email", value: "Ada@Example.com", role: "admin" },
          { kind: "domain", value: "example.com", role: "viewer" },
        ],
        "ada@example.com",
        ["editors"],
      ),
    ).toBe("admin");
    expect(
      matchAccessRule(
        [{ kind: "domain", value: "@example.com", role: "viewer" }],
        "ada@example.com",
        [],
      ),
    ).toBe("viewer");
    expect(
      matchAccessRule(
        [{ kind: "group", value: "owners", role: "owner" }],
        "ada@example.com",
        [],
      ),
    ).toBeNull();
  });
});
