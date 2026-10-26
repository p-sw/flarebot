// SPDX-License-Identifier: MIT

export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ["read", "monitors:write", "heartbeat"] as const;
export type Scope = (typeof SCOPES)[number];

export const ACTIONS = [
  "dashboard.read",
  "monitors.read",
  "monitors.write",
  "monitors.heartbeat",
  "outages.read",
  "outages.ack",
  "incidents.read",
  "incidents.write",
  "maintenance.read",
  "maintenance.write",
  "channels.read",
  "channels.write",
  "status_pages.read",
  "status_pages.write",
  "users.read",
  "users.invite",
  "users.role",
  "tokens.read",
  "tokens.write",
  "audit.read",
  "mail.read",
  "mail.write",
  "instance.settings",
  "instance.transfer",
] as const;
export type Action = (typeof ACTIONS)[number];

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

const MIN_ROLE: Record<Action, Role> = {
  "dashboard.read": "viewer",
  "monitors.read": "viewer",
  "monitors.write": "editor",
  "monitors.heartbeat": "viewer",
  "outages.read": "viewer",
  "outages.ack": "editor",
  "incidents.read": "viewer",
  "incidents.write": "editor",
  "maintenance.read": "viewer",
  "maintenance.write": "editor",
  "channels.read": "viewer",
  "channels.write": "admin",
  "status_pages.read": "viewer",
  "status_pages.write": "admin",
  "users.read": "admin",
  "users.invite": "admin",
  "users.role": "admin",
  "tokens.read": "viewer",
  "tokens.write": "viewer",
  "audit.read": "admin",
  "mail.read": "owner",
  "mail.write": "owner",
  "instance.settings": "owner",
  "instance.transfer": "owner",
};

export type Actor = {
  role: Role;
  tokenScopes?: readonly Scope[] | null;
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export function scopesForRole(role: Role): Scope[] {
  if (role === "viewer") return ["read"];
  return ["read", "monitors:write", "heartbeat"];
}

export function roleAllows(role: Role, action: Action): boolean {
  return RANK[role] >= RANK[MIN_ROLE[action]];
}

export function scopeAllows(scopes: readonly Scope[], action: Action): boolean {
  if (action === "monitors.heartbeat") return scopes.includes("heartbeat");
  if (
    action === "monitors.write" ||
    action === "outages.ack" ||
    action === "incidents.write" ||
    action === "maintenance.write"
  ) {
    return scopes.includes("monitors:write");
  }
  if (
    action.endsWith(".read") ||
    action === "dashboard.read" ||
    action === "tokens.read"
  ) {
    return scopes.includes("read") || scopes.includes("monitors:write");
  }
  return false;
}

/**
 * Single authorization check. `resource` is accepted so later group and team
 * rules can use it without changing call sites. MVP ignores it.
 * Token actors are limited to the narrower of their role and their scopes.
 * Session actors pass `tokenScopes` as null or omit it.
 */
export function can(
  actor: Actor,
  action: Action,
  _resource?: unknown,
): boolean {
  if (!roleAllows(actor.role, action)) return false;
  if (actor.tokenScopes) return scopeAllows(actor.tokenScopes, action);
  return true;
}

export function assertScopesWithinRole(
  role: Role,
  scopes: readonly Scope[],
): boolean {
  const allowed = new Set(scopesForRole(role));
  return scopes.every((scope) => allowed.has(scope));
}
