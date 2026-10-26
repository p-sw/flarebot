// SPDX-License-Identifier: MIT

import type { Role } from "../../shared/permissions";
import { isRole } from "../../shared/permissions";
import {
  ACCESS_PROVIDER_ID,
  accessCertsUrl,
  accessIdentityUrl,
  accessIssuer,
  accessTeamHost,
  audienceIncludes,
  claimValue,
  emailDomainAllowed,
  matchAccessRule,
  type SsoPolicy,
  stringList,
  timeClaimsOk,
} from "../../shared/sso";
import { SsoFlowError } from "./errors";
import { verifyAgainstUrl } from "./jwt";
import { linkSsoAccount, rulesNeedGroups } from "./link";

function plainEmail(payload: Record<string, unknown>): string | null {
  const email = claimValue(payload, "email");
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

async function identityGroups(
  policyHost: string,
  token: string,
): Promise<string[]> {
  const response = await fetch(accessIdentityUrl(policyHost), {
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: "application/json",
      "cf-access-jwt-assertion": token,
    },
  });
  if (response.status >= 300 || !response.ok) return [];
  const text = await response.text();
  if (text.length > 65_536) return [];
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object") return [];
    return stringList(claimValue(body as Record<string, unknown>, "groups"));
  } catch {
    return [];
  }
}

export async function loginWithAccess(
  env: Env,
  policy: SsoPolicy,
  token: string,
  ip: string | null,
): Promise<{ userId: string; created: boolean; email: string }> {
  if (!policy.access.enabled) throw new SsoFlowError("config");
  const host = accessTeamHost(policy.access.teamName);
  if (!host || policy.access.audiences.length === 0) {
    throw new SsoFlowError("config");
  }
  if (!token || token.length > 16_000 || token.split(".").length !== 3) {
    throw new SsoFlowError("token");
  }
  const payload = await verifyAgainstUrl(env, token, accessCertsUrl(host));
  const iss = claimValue(payload, "iss");
  if (
    typeof iss !== "string" ||
    iss.replace(/\/+$/, "") !== accessIssuer(host)
  ) {
    throw new SsoFlowError("token");
  }
  if (!audienceIncludes(claimValue(payload, "aud"), policy.access.audiences)) {
    throw new SsoFlowError("token");
  }
  if (!timeClaimsOk(payload, Date.now())) throw new SsoFlowError("token");
  const type = claimValue(payload, "type");
  if (type !== undefined && type !== "app") throw new SsoFlowError("token");
  const email = plainEmail(payload);
  if (!email) throw new SsoFlowError("email");
  if (!emailDomainAllowed(email, policy.access.allowedDomains)) {
    throw new SsoFlowError("domain", email);
  }
  let groups = stringList(
    claimValue(payload, policy.access.groupsClaim || "groups"),
  );
  if (groups.length === 0 && rulesNeedGroups(policy.access.rules)) {
    groups = await identityGroups(host, token);
  }
  const role = matchAccessRule(policy.access.rules, email, groups);
  if (!role) throw new SsoFlowError("denied", email);
  const subjectValue = claimValue(payload, "sub");
  const subject =
    typeof subjectValue === "string" && subjectValue.trim()
      ? subjectValue.trim().slice(0, 500)
      : email;
  const nameValue = claimValue(payload, "name");
  const name =
    typeof nameValue === "string" && nameValue.trim()
      ? nameValue.trim().slice(0, 80)
      : email.slice(0, 80);
  if (!isRole(role)) throw new SsoFlowError("config");
  return linkSsoAccount(env, {
    providerId: ACCESS_PROVIDER_ID,
    subject,
    email,
    name,
    mappedRole: role as Role,
    jitEnabled: policy.access.jitEnabled,
    jitRole: role,
    allowedDomains: policy.access.allowedDomains,
    ip,
  });
}
